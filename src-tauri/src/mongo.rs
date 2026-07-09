// MongoDB data-source path. The SQL engines live in `db.rs` over `sqlx::Any`; MongoDB is a
// document store with no SQL, so it gets its own module, its own client registry, and its own
// per-command functions. Crucially it produces the SAME IPC structs as the SQL path
// (`TableRef` / `TableRows` / `TableColumn` / `QueryOutcome`) so the frontend renders documents
// through the one shared `DataGrid`: documents are flattened DBeaver-style - top-level keys
// become columns (`_id` first + primary key), nested objects/arrays become compact JSON text,
// scalars become their JSON-literal text, a missing key becomes a NULL cell.

use crate::db::{
    ConnectCatalog, IndexInfo, QueryOutcome, RowMutation, SchemaColumn, Sort, TableColumn, TableRef,
    TableRows, TableSchema, TableStructure,
};
use futures_util::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId, Bson, Document};
use mongodb::options::ClientOptions;
use mongodb::Client;
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

// MongoDB connection config sent by the frontend (engine tag is matched in `lib.rs`, not here).
// `uri`, when non-empty, overrides the discrete fields (replica sets / Atlas / mongodb+srv).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MongoConfig {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
    pub password: String,
    #[serde(default)]
    pub uri: Option<String>,
}

// A held Mongo client (cheap to clone - `Client` is an `Arc` internally) plus the target database
// name, mirroring `db.rs`'s `HeldConnection`.
#[derive(Clone)]
struct MongoConn {
    client: Client,
    database: String,
}

static MONGOS: LazyLock<Mutex<HashMap<String, MongoConn>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

// True when a Mongo client is held for this id - the `lib.rs` dispatcher routes to this module
// when it is, and to the SQL path otherwise.
pub fn is_connected(connection_id: &str) -> bool {
    MONGOS.lock().unwrap().contains_key(connection_id)
}

fn with_client(connection_id: &str) -> Result<MongoConn, String> {
    MONGOS
        .lock()
        .unwrap()
        .get(connection_id)
        .cloned()
        .ok_or_else(|| format!("not connected: no connection for id '{connection_id}'"))
}

// Credentials are percent-encoded so an `@`/`:`/`/` in a user or password can't break the
// `mongodb://user:pass@host:port/db` shape. Same set as the SQL URL builder.
const CRED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

fn encode(value: &str) -> String {
    utf8_percent_encode(value, CRED).to_string()
}

// Builds the connection string. An explicit non-empty `uri` is returned verbatim (the user owns
// it); otherwise the discrete fields are assembled into a percent-encoded `mongodb://` URL.
pub fn mongo_uri(config: &MongoConfig) -> String {
    if let Some(uri) = config.uri.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        return uri.to_string();
    }
    format!(
        "mongodb://{user}:{password}@{host}:{port}/{database}",
        user = encode(&config.user),
        password = encode(&config.password),
        host = config.host,
        port = config.port,
        database = encode(&config.database),
    )
}

// Recursively maps a BSON value to a plain serde_json value for display. ObjectId/DateTime/
// Decimal128 collapse to their natural string form (not extended-JSON `{"$oid":...}`) so a cell
// shows `65f..a1`, not `{"$oid":"65f..a1"}`.
fn bson_to_json(value: &Bson) -> Value {
    match value {
        Bson::Null | Bson::Undefined => Value::Null,
        Bson::String(text) => Value::String(text.clone()),
        Bson::Boolean(flag) => Value::Bool(*flag),
        Bson::Int32(number) => Value::from(*number),
        Bson::Int64(number) => Value::from(*number),
        Bson::Double(number) => Value::from(*number),
        Bson::ObjectId(oid) => Value::String(oid.to_hex()),
        Bson::DateTime(date) => Value::String(
            date.try_to_rfc3339_string()
                .unwrap_or_else(|_| date.to_string()),
        ),
        Bson::Decimal128(decimal) => Value::String(decimal.to_string()),
        Bson::Array(items) => Value::Array(items.iter().map(bson_to_json).collect()),
        Bson::Document(document) => Value::Object(
            document
                .iter()
                .map(|(key, value)| (key.clone(), bson_to_json(value)))
                .collect(),
        ),
        other => Value::String(format!("{other:?}")),
    }
}

// One grid cell from a BSON value: null -> None; a scalar string -> the bare string (matching the
// SQL grid's text cells); a nested object/array -> compact JSON text; any other scalar -> its
// JSON-literal text. So `address: {city}` shows `{"city":"Wwa"}` and `age: 36` shows `36`.
fn bson_to_cell(value: &Bson) -> Option<String> {
    match bson_to_json(value) {
        Value::Null => None,
        Value::String(text) => Some(text),
        json @ (Value::Object(_) | Value::Array(_)) => Some(json.to_string()),
        other => Some(other.to_string()),
    }
}

// A short BSON type label for the column header subline (mirrors the SQL `dataType`).
fn bson_type_label(value: &Bson) -> &'static str {
    match value {
        Bson::ObjectId(_) => "objectId",
        Bson::String(_) => "string",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Double(_) => "double",
        Bson::Boolean(_) => "bool",
        Bson::Null | Bson::Undefined => "null",
        Bson::Document(_) => "object",
        Bson::Array(_) => "array",
        Bson::DateTime(_) => "date",
        Bson::Decimal128(_) => "decimal",
        _ => "bson",
    }
}

// Flattens a page of documents into the shared grid shape. Column order: `_id` first, then the
// union of every other top-level key in first-seen order. Each column's `dataType` is the label
// of the first non-null sampled value (else ""); `nullable` is always true (a document may omit
// any field); `isPrimaryKey` marks `_id`. A document missing a column yields a NULL cell - the
// grid cannot tell "field absent" from "field = null" (documented limitation).
pub fn flatten_documents(documents: &[Document]) -> (Vec<TableColumn>, Vec<Vec<Option<String>>>) {
    let mut names: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    // `_id` is always the first column - every Mongo document has one - so even an empty collection
    // shows the `_id` header (the grid renders headers + "No rows.") rather than a header-less grid.
    names.push("_id".to_string());
    seen.insert("_id".to_string());
    for document in documents {
        for key in document.keys() {
            if seen.insert(key.clone()) {
                names.push(key.clone());
            }
        }
    }

    let data_type = |column: &str| -> String {
        documents
            .iter()
            .filter_map(|document| document.get(column))
            .find(|value| !matches!(value, Bson::Null))
            .map(bson_type_label)
            .unwrap_or("")
            .to_string()
    };

    let columns = names
        .iter()
        .map(|name| TableColumn {
            name: name.clone(),
            data_type: data_type(name),
            nullable: true,
            is_primary_key: name == "_id",
        })
        .collect();

    let rows = documents
        .iter()
        .map(|document| {
            names
                .iter()
                .map(|name| document.get(name).and_then(bson_to_cell))
                .collect()
        })
        .collect();

    (columns, rows)
}

// Converts a JSON object value to a BSON document via `json_value_to_bson` rather than
// `bson::to_document`: the crate enables serde_json's `arbitrary_precision`, under which
// `to_document` serialises numbers as a `$serde_json::private::Number` wrapper that Mongo rejects.
// Going through our own `Value -> Bson` map keeps `42` an Int64.
fn json_object_to_document(value: Value) -> Result<Document, String> {
    match json_value_to_bson(value) {
        Bson::Document(document) => Ok(document),
        _ => Err("expected a JSON object".to_string()),
    }
}

// Walks the raw JSON tree and rejects a malformed Extended JSON type wrapper (e.g. a `$oid` whose
// value is not a 24-hex string), so a typo'd ObjectId is a clear error instead of silently matching
// a literal `{"$oid": "..."}` subdocument that can never hit. A well-formed wrapper passes; a
// non-wrapper object recurses into its values.
fn validate_extended_json(value: &Value) -> Result<(), String> {
    match value {
        Value::Array(items) => items.iter().try_for_each(validate_extended_json),
        Value::Object(map) => {
            if let Some(key) = map.keys().find(|key| key.starts_with('$')) {
                let is_type_wrapper = matches!(
                    key.as_str(),
                    "$oid" | "$numberLong" | "$numberInt" | "$numberDouble" | "$date"
                );
                if is_type_wrapper && extended_json_type(map).is_none() {
                    return Err(format!("invalid Extended JSON value for {key}"));
                }
            }
            map.values().try_for_each(validate_extended_json)
        }
        _ => Ok(()),
    }
}

// Parses a user JSON filter string into a BSON query document. Empty/whitespace -> match-all.
// A non-object (array, scalar) or malformed JSON returns an Err surfaced in the UI - never panics.
pub fn parse_filter(text: &str) -> Result<Document, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(Document::new());
    }
    let value: Value = serde_json::from_str(trimmed).map_err(|error| error.to_string())?;
    if !value.is_object() {
        return Err("filter must be a JSON object".to_string());
    }
    validate_extended_json(&value)?;
    json_object_to_document(value)
}

// Parses a user JSON aggregation pipeline (a JSON array of stage objects) into BSON documents.
fn parse_pipeline(text: &str) -> Result<Vec<Document>, String> {
    let value: Value = serde_json::from_str(text.trim()).map_err(|error| error.to_string())?;
    validate_extended_json(&value)?;
    let Value::Array(stages) = value else {
        return Err("pipeline must be a JSON array of stages".to_string());
    };
    stages
        .into_iter()
        .map(|stage| {
            if !stage.is_object() {
                return Err("each pipeline stage must be a JSON object".to_string());
            }
            json_object_to_document(stage)
        })
        .collect()
}

// Maps a JSON value to BSON, preferring Int64 for whole numbers so an edited `42` stays an integer
// rather than a float. A single-key object whose key is a recognised MongoDB Extended JSON type
// wrapper (`$oid`, `$numberLong`, ...) is decoded to that BSON type instead of a plain document, so
// an ObjectId `_id` can be queried as `{"_id": {"$oid": "..."}}`. Returns Err only via the public
// callers (an invalid `$oid` hex), surfaced as a filter error; here it falls back to a document.
fn json_value_to_bson(value: Value) -> Bson {
    match value {
        Value::Null => Bson::Null,
        Value::Bool(flag) => Bson::Boolean(flag),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                Bson::Int64(integer)
            } else {
                Bson::Double(number.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(text) => Bson::String(text),
        Value::Array(items) => Bson::Array(items.into_iter().map(json_value_to_bson).collect()),
        Value::Object(map) => extended_json_type(&map)
            .unwrap_or_else(|| {
                Bson::Document(
                    map.into_iter()
                        .map(|(key, value)| (key, json_value_to_bson(value)))
                        .collect(),
                )
            }),
    }
}

// Decodes a MongoDB Extended JSON type wrapper - a single-key object whose key is `$oid` /
// `$numberLong` / `$numberInt` / `$numberDouble` / `$date` - to its BSON type. Returns None for any
// other object (including multi-key and query-operator objects like `{"$gt": 1}`), so only a real
// one-key type wrapper is intercepted; everything else stays a plain document. An invalid payload
// (e.g. a non-hex `$oid`) yields None so the value degrades to a literal rather than panicking - the
// public `parse_filter` separately rejects an unmatched `$oid` for a clear error.
fn extended_json_type(map: &serde_json::Map<String, Value>) -> Option<Bson> {
    if map.len() != 1 {
        return None;
    }
    let (key, value) = map.iter().next()?;
    match key.as_str() {
        "$oid" => value
            .as_str()
            .and_then(|hex| ObjectId::parse_str(hex).ok())
            .map(Bson::ObjectId),
        "$numberLong" => value
            .as_str()
            .and_then(|text| text.parse::<i64>().ok())
            .map(Bson::Int64),
        "$numberInt" => value
            .as_str()
            .and_then(|text| text.parse::<i32>().ok())
            .map(Bson::Int32),
        "$numberDouble" => value
            .as_str()
            .and_then(|text| text.parse::<f64>().ok())
            .map(Bson::Double),
        "$date" => value
            .as_str()
            .and_then(|text| mongodb::bson::DateTime::parse_rfc3339_str(text).ok())
            .map(Bson::DateTime),
        _ => None,
    }
}

// Interprets a cell's text as a JSON literal so BSON scalar types survive an edit: `42` -> int,
// `true` -> bool, `null` -> null, `"x"` -> string. Bare text that is not valid JSON (e.g. `paid`)
// falls back to a string, so the common case "type a word" still works.
fn json_literal_to_bson(text: &str) -> Bson {
    match serde_json::from_str::<Value>(text.trim()) {
        Ok(value) => json_value_to_bson(value),
        Err(_) => Bson::String(text.to_string()),
    }
}

// Builds the `{_id: ...}` match filter. An `_id` that parses as an ObjectId matches as one;
// otherwise it matches by its JSON-literal value (string/int/...), so a string `_id` works (E-4).
fn id_filter(pk_value: &str) -> Document {
    match ObjectId::parse_str(pk_value) {
        Ok(oid) => doc! { "_id": oid },
        Err(_) => doc! { "_id": json_literal_to_bson(pk_value) },
    }
}

// `updateOne({_id}, {$set: {column: value}})`. Editing `_id` is rejected (the match key is the id).
pub fn build_cell_update(
    pk_value: &str,
    column: &str,
    new_value: Option<&str>,
) -> Result<(Document, Document), String> {
    if column == "_id" {
        return Err("the _id field cannot be edited".to_string());
    }
    let value = match new_value {
        None => Bson::Null,
        Some(text) => json_literal_to_bson(text),
    };
    Ok((id_filter(pk_value), doc! { "$set": { column: value } }))
}

// `insertOne(doc)` from the staged values (each parsed as a JSON literal; None -> null).
pub fn build_insert(values: &std::collections::BTreeMap<String, Option<String>>) -> Document {
    values
        .iter()
        .map(|(key, value)| {
            let bson = match value {
                None => Bson::Null,
                Some(text) => json_literal_to_bson(text),
            };
            (key.clone(), bson)
        })
        .collect()
}

// `deleteOne({_id})`.
pub fn build_delete(pk_value: &str) -> Document {
    id_filter(pk_value)
}

// `replaceOne({_id}, document)` from the edited full-document JSON. The document must be a JSON
// object; anything else (array/scalar/malformed) is an error.
pub fn build_replace(pk_value: &str, document_json: &str) -> Result<(Document, Document), String> {
    let value: Value =
        serde_json::from_str(document_json.trim()).map_err(|error| error.to_string())?;
    match json_value_to_bson(value) {
        Bson::Document(document) => Ok((id_filter(pk_value), document)),
        _ => Err("a replacement document must be a JSON object".to_string()),
    }
}

// Opens a Mongo client (fail-fast server selection), pings, lists collections, and holds the
// client keyed by id. Cancellable via the SHARED cancel registry under the same `connect:` key the
// SQL connect uses, so the Settings "Cancel" button aborts a stuck Mongo connect identically.
pub async fn connect(
    connection_id: String,
    config: MongoConfig,
) -> Result<ConnectCatalog, String> {
    let cancel_key = crate::db::connect_cancel_key(&connection_id);
    let token = crate::db::register_cancel_token(&cancel_key);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = open_and_list(connection_id, config) => result,
    };
    crate::db::unregister_cancel_token(&cancel_key);
    result
}

async fn open_and_list(
    connection_id: String,
    config: MongoConfig,
) -> Result<ConnectCatalog, String> {
    let mut options = ClientOptions::parse(mongo_uri(&config))
        .await
        .map_err(|error| error.to_string())?;
    // Fail fast instead of hanging on the ~30s default when the host is wrong.
    options.server_selection_timeout = Some(Duration::from_secs(10));
    options.connect_timeout = Some(Duration::from_secs(10));

    // The target database: the discrete `Database` field when set, else the URI's path database
    // (`mongodb://.../<db>`). A URI overrides the (often blank) discrete field, so its db must win
    // when the field is empty - otherwise `client.database("")` fails with InvalidNamespace.
    let database_name = match config.database.trim() {
        "" => options
            .default_database
            .clone()
            .map(|db| db.to_string())
            .filter(|db| !db.is_empty())
            .ok_or_else(|| {
                "no database: set the Database field or include it in the connection string"
                    .to_string()
            })?,
        name => name.to_string(),
    };

    let client = Client::with_options(options).map_err(|error| error.to_string())?;
    let database = client.database(&database_name);

    // Ping so a bad host/auth fails here (red dot + toast) rather than on the first browse.
    database
        .run_command(doc! { "ping": 1 })
        .await
        .map_err(|error| error.to_string())?;

    let mut names = database
        .list_collection_names()
        .await
        .map_err(|error| error.to_string())?;
    names.sort();

    MONGOS.lock().unwrap().insert(
        connection_id,
        MongoConn {
            client,
            database: database_name,
        },
    );

    // MongoDB has no SQL-style views; the Views tab stays empty for a Mongo connection.
    Ok(ConnectCatalog {
        tables: names
            .into_iter()
            .map(|name| TableRef { schema: None, name })
            .collect(),
        views: Vec::new(),
    })
}

pub async fn disconnect(connection_id: String) {
    MONGOS.lock().unwrap().remove(&connection_id);
}

// The read-only Structure view for a Mongo collection (F6 #14): only indexes are meaningful -
// documents have no fixed columns, foreign keys, or SQL constraints, so those sections are empty.
// Each index's `keys` document maps to the ordered column list; `_id_` is the primary index.
pub async fn fetch_table_structure(
    connection_id: String,
    collection: String,
) -> Result<TableStructure, String> {
    let held = with_client(&connection_id)?;
    let coll = held
        .client
        .database(&held.database)
        .collection::<Document>(&collection);

    let models: Vec<mongodb::IndexModel> = coll
        .list_indexes()
        .await
        .map_err(|error| error.to_string())?
        .try_collect()
        .await
        .map_err(|error| error.to_string())?;

    let indexes = models
        .into_iter()
        .map(|model| {
            let name = model
                .options
                .as_ref()
                .and_then(|options| options.name.clone())
                .unwrap_or_default();
            let is_unique = model
                .options
                .as_ref()
                .and_then(|options| options.unique)
                .unwrap_or(false);
            let columns = model.keys.keys().cloned().collect::<Vec<_>>();
            IndexInfo {
                is_primary: name == "_id_",
                name,
                columns,
                is_unique,
            }
        })
        .collect();

    Ok(TableStructure {
        columns: Vec::new(),
        indexes,
        foreign_keys: Vec::new(),
        constraints: Vec::new(),
    })
}

fn sort_doc(sort: Option<&Sort>) -> Document {
    match sort {
        Some(sort) => doc! { &sort.column: if sort.descending { -1 } else { 1 } },
        None => Document::new(),
    }
}

// Browses one collection: find(filter).sort().skip(offset).limit(limit), flattened to the grid.
pub async fn fetch_documents(
    connection_id: String,
    collection: String,
    limit: u32,
    offset: u32,
    filter: Option<String>,
    sort: Option<Sort>,
) -> Result<TableRows, String> {
    let held = with_client(&connection_id)?;
    let query = parse_filter(filter.as_deref().unwrap_or(""))?;
    let coll = held
        .client
        .database(&held.database)
        .collection::<Document>(&collection);

    let documents: Vec<Document> = coll
        .find(query)
        .sort(sort_doc(sort.as_ref()))
        .skip(offset as u64)
        .limit(limit as i64)
        .await
        .map_err(|error| error.to_string())?
        .try_collect()
        .await
        .map_err(|error| error.to_string())?;

    let (columns, rows) = flatten_documents(&documents);
    let primary_key = columns
        .iter()
        .find(|column| column.is_primary_key)
        .map(|column| column.name.clone());
    Ok(TableRows {
        columns,
        rows,
        primary_key,
    })
}

pub async fn count_documents(
    connection_id: String,
    collection: String,
    filter: Option<String>,
) -> Result<i64, String> {
    let held = with_client(&connection_id)?;
    let query = parse_filter(filter.as_deref().unwrap_or(""))?;
    let count = held
        .client
        .database(&held.database)
        .collection::<Document>(&collection)
        .count_documents(query)
        .await
        .map_err(|error| error.to_string())?;
    Ok(count as i64)
}

// The number of documents sampled per collection to derive its top-level field names for
// autocomplete. Mongo has no fixed schema, so this is a best-effort sample, not a guarantee.
const SCHEMA_SAMPLE_SIZE: i64 = 50;

// Collects the union of top-level field names across a sample of documents, in first-seen order
// with `_id` first (so the autocomplete lists the key field first, matching the grid).
pub fn sample_fields(documents: &[Document]) -> Vec<String> {
    let mut fields: Vec<String> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    if documents.iter().any(|document| document.contains_key("_id")) {
        fields.push("_id".to_string());
        seen.insert("_id".to_string());
    }
    for document in documents {
        for key in document.keys() {
            if seen.insert(key.clone()) {
                fields.push(key.clone());
            }
        }
    }
    fields
}

// Samples each collection's top-level fields so the Query tab can autocomplete field names. Mongo
// has no SQL schema; this returns one `TableSchema` per collection (schema None - no schema level),
// its columns being the sampled field names (types left blank - not introspected). A best-effort
// fetch run alongside the catalog on connect.
pub async fn fetch_schema(connection_id: String) -> Result<Vec<TableSchema>, String> {
    let held = with_client(&connection_id)?;
    let database = held.client.database(&held.database);
    let mut names = database
        .list_collection_names()
        .await
        .map_err(|error| error.to_string())?;
    names.sort();

    let mut schemas = Vec::with_capacity(names.len());
    for name in names {
        let documents: Vec<Document> = database
            .collection::<Document>(&name)
            .find(Document::new())
            .limit(SCHEMA_SAMPLE_SIZE)
            .await
            .map_err(|error| error.to_string())?
            .try_collect()
            .await
            .map_err(|error| error.to_string())?;
        schemas.push(TableSchema {
            schema: None,
            name,
            columns: sample_fields(&documents)
                .into_iter()
                .map(|field| SchemaColumn {
                    name: field,
                    data_type: String::new(),
                })
                .collect(),
        });
    }
    Ok(schemas)
}

// Applies staged row mutations as Mongo writes on one collection: cell -> updateOne $set,
// insert -> insertOne, delete -> deleteOne, replace -> replaceOne. Returns the affected count
// (modified + inserted + deleted). Stops at the first error like the SQL path.
pub async fn apply_mutations(
    connection_id: String,
    collection: String,
    mutations: Vec<RowMutation>,
) -> Result<u64, String> {
    let held = with_client(&connection_id)?;
    let coll = held
        .client
        .database(&held.database)
        .collection::<Document>(&collection);

    let mut affected: u64 = 0;
    for mutation in &mutations {
        match mutation {
            RowMutation::Cell {
                column,
                pk_value,
                new_value,
            } => {
                let (filter, update) =
                    build_cell_update(pk_value, column, new_value.as_deref())?;
                let result = coll
                    .update_one(filter, update)
                    .await
                    .map_err(|error| error.to_string())?;
                affected += result.modified_count;
            }
            RowMutation::Insert { values } => {
                coll.insert_one(build_insert(values))
                    .await
                    .map_err(|error| error.to_string())?;
                affected += 1;
            }
            RowMutation::Delete { pk_value } => {
                let result = coll
                    .delete_one(build_delete(pk_value))
                    .await
                    .map_err(|error| error.to_string())?;
                affected += result.deleted_count;
            }
            RowMutation::Replace { pk_value, document } => {
                let (filter, replacement) = build_replace(pk_value, document)?;
                let result = coll
                    .replace_one(filter, replacement)
                    .await
                    .map_err(|error| error.to_string())?;
                affected += result.modified_count;
            }
        }
    }
    Ok(affected)
}

fn documents_outcome(statement: String, documents: &[Document]) -> QueryOutcome {
    let (columns, rows) = flatten_documents(documents);
    let count = rows.len();
    QueryOutcome {
        statement,
        columns: columns.into_iter().map(|column| column.name).collect(),
        rows,
        rows_affected: count as u64,
        returns_rows: true,
        message: format!("{count} document(s)"),
    }
}

// The operations a Query-tab command can run: two reads (find/aggregate, capped by `limit`) and the
// write ops (insert/update/delete/replace). Writes are blocked upstream when the database is
// read-only (F11) - the backend runs whatever it's given.
#[derive(Debug, PartialEq)]
enum MongoOp {
    Find,
    Aggregate,
    InsertOne,
    InsertMany,
    UpdateOne,
    UpdateMany,
    DeleteOne,
    DeleteMany,
    ReplaceOne,
}

// One parsed `db.<collection>.<op>(<json>)` command. The collection travels IN the command text
// (like a SQL `FROM`), so the Query tab is self-contained, saveable as a named script, and needs no
// collection picker.
#[derive(Debug, PartialEq)]
struct MongoCommand {
    collection: String,
    op: MongoOp,
    // The raw arguments between the outer parens, split on top-level commas (a comma inside a
    // string or a brace/bracket group stays). Reads use the first arg (filter/pipeline); the write
    // ops take two (`updateOne(filter, update)` etc.). Parsed to BSON later, per op.
    args: Vec<String>,
}

// The op name -> MongoOp. Unknown -> Err (listing the supported set).
fn parse_op(method: &str) -> Result<MongoOp, String> {
    match method {
        "find" => Ok(MongoOp::Find),
        "aggregate" => Ok(MongoOp::Aggregate),
        "insertOne" => Ok(MongoOp::InsertOne),
        "insertMany" => Ok(MongoOp::InsertMany),
        "updateOne" => Ok(MongoOp::UpdateOne),
        "updateMany" => Ok(MongoOp::UpdateMany),
        "deleteOne" => Ok(MongoOp::DeleteOne),
        "deleteMany" => Ok(MongoOp::DeleteMany),
        "replaceOne" => Ok(MongoOp::ReplaceOne),
        other => Err(format!(
            "unsupported operation '{other}' - use find/aggregate/insertOne/insertMany/updateOne/updateMany/deleteOne/deleteMany/replaceOne"
        )),
    }
}

// Splits the raw text between the outer parens into top-level arguments on commas, leaving a comma
// inside a string literal or a bracket/brace/paren group untouched (mirrors split_commands). An
// all-whitespace body yields an empty vec (a bare `find()` = match-all).
fn split_args(body: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut depth: i32 = 0;
    let mut in_string: Option<char> = None;
    let mut previous = '\0';
    for character in body.chars() {
        match in_string {
            Some(quote) => {
                if character == quote && previous != '\\' {
                    in_string = None;
                }
            }
            None => match character {
                '"' | '\'' => in_string = Some(character),
                '(' | '[' | '{' => depth += 1,
                ')' | ']' | '}' => depth -= 1,
                ',' if depth == 0 => {
                    args.push(current.trim().to_string());
                    current.clear();
                    previous = character;
                    continue;
                }
                _ => {}
            },
        }
        current.push(character);
        previous = character;
    }
    let last = current.trim().to_string();
    if !last.is_empty() || !args.is_empty() {
        args.push(last);
    }
    args
}

// Parses one `db.<collection>.<op>(<args>)` command. The collection name is a bare identifier or a
// quoted string (Mongo allows dots/dashes in names); the args between the outer parens are split on
// top-level commas and parsed to BSON per op. Whitespace and a trailing `;` are tolerated. Anything
// else is a clear error (never panics).
fn parse_command(text: &str) -> Result<MongoCommand, String> {
    let trimmed = text.trim().trim_end_matches(';').trim();
    let rest = trimmed
        .strip_prefix("db.")
        .ok_or_else(|| "command must start with db.<collection>".to_string())?;
    let dot = rest
        .find('.')
        .ok_or_else(|| "expected db.<collection>.<op>(...)".to_string())?;
    let collection_token = &rest[..dot];
    let collection = collection_token
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .or_else(|| {
            collection_token
                .strip_prefix('\'')
                .and_then(|inner| inner.strip_suffix('\''))
        })
        .unwrap_or(collection_token)
        .to_string();
    if collection.is_empty() {
        return Err("missing collection name".to_string());
    }

    let after = &rest[dot + 1..];
    let open = after
        .find('(')
        .ok_or_else(|| "expected <op>(".to_string())?;
    let op = parse_op(after[..open].trim())?;
    let arg_with_close = &after[open + 1..];
    let close = arg_with_close
        .rfind(')')
        .ok_or_else(|| "missing closing )".to_string())?;
    let args = split_args(arg_with_close[..close].trim());
    Ok(MongoCommand {
        collection,
        op,
        args,
    })
}

// The nth arg's raw text (empty string when absent), for the read ops that tolerate a missing arg.
fn arg_or_empty(command: &MongoCommand, index: usize) -> &str {
    command
        .args
        .get(index)
        .map(String::as_str)
        .unwrap_or("")
}

// The nth arg parsed as a required JSON object (update/replacement/insert document). A missing,
// blank, non-object, or malformed arg is a clear error. Extended JSON wrappers are validated.
fn arg_document(command: &MongoCommand, index: usize, what: &str) -> Result<Document, String> {
    let raw = arg_or_empty(command, index).trim();
    if raw.is_empty() {
        return Err(format!("{what} is required"));
    }
    let value: Value = serde_json::from_str(raw).map_err(|error| error.to_string())?;
    validate_extended_json(&value)?;
    json_object_to_document(value)
}

// A write op's outcome: no rows, just the affected count (mirrors the SQL non_row_outcome shape).
fn write_outcome(statement: String, affected: u64, verb: &str) -> QueryOutcome {
    QueryOutcome {
        statement,
        columns: Vec::new(),
        rows: Vec::new(),
        rows_affected: affected,
        returns_rows: false,
        message: format!("{affected} {verb}"),
    }
}

// Runs one self-contained Query-tab command. Reads (`find`/`aggregate`) are capped at `limit` and
// return rows; writes (`insertOne`/`insertMany`/`updateOne`/`updateMany`/`deleteOne`/`deleteMany`/
// `replaceOne`) run the driver op and return the affected count. Writes are gated upstream when the
// database is read-only (F11) - this runs whatever it's handed.
async fn run_command(
    held: &MongoConn,
    command: &MongoCommand,
    limit: u32,
) -> Result<QueryOutcome, String> {
    let coll = held
        .client
        .database(&held.database)
        .collection::<Document>(&command.collection);
    let name = &command.collection;
    match command.op {
        MongoOp::Find => {
            let query = parse_filter(arg_or_empty(command, 0))?;
            let documents: Vec<Document> = coll
                .find(query)
                .limit(limit as i64)
                .await
                .map_err(|error| error.to_string())?
                .try_collect()
                .await
                .map_err(|error| error.to_string())?;
            Ok(documents_outcome(format!("db.{name}.find(...)"), &documents))
        }
        MongoOp::Aggregate => {
            let mut stages = parse_pipeline(arg_or_empty(command, 0))?;
            stages.push(doc! { "$limit": limit as i64 });
            let documents: Vec<Document> = coll
                .aggregate(stages)
                .await
                .map_err(|error| error.to_string())?
                .try_collect()
                .await
                .map_err(|error| error.to_string())?;
            Ok(documents_outcome(
                format!("db.{name}.aggregate(...)"),
                &documents,
            ))
        }
        MongoOp::InsertOne => {
            let document = arg_document(command, 0, "insertOne document")?;
            coll.insert_one(document)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(format!("db.{name}.insertOne(...)"), 1, "inserted"))
        }
        MongoOp::InsertMany => {
            let documents = parse_document_array(arg_or_empty(command, 0))?;
            if documents.is_empty() {
                return Err("insertMany requires a non-empty array of documents".to_string());
            }
            let result = coll
                .insert_many(documents)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.insertMany(...)"),
                result.inserted_ids.len() as u64,
                "inserted",
            ))
        }
        MongoOp::UpdateOne => {
            let filter = parse_filter(arg_or_empty(command, 0))?;
            let update = arg_document(command, 1, "updateOne update document")?;
            let result = coll
                .update_one(filter, update)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.updateOne(...)"),
                result.modified_count,
                "modified",
            ))
        }
        MongoOp::UpdateMany => {
            let filter = parse_filter(arg_or_empty(command, 0))?;
            let update = arg_document(command, 1, "updateMany update document")?;
            let result = coll
                .update_many(filter, update)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.updateMany(...)"),
                result.modified_count,
                "modified",
            ))
        }
        MongoOp::DeleteOne => {
            let filter = parse_filter(arg_or_empty(command, 0))?;
            let result = coll
                .delete_one(filter)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.deleteOne(...)"),
                result.deleted_count,
                "deleted",
            ))
        }
        MongoOp::DeleteMany => {
            let filter = parse_filter(arg_or_empty(command, 0))?;
            let result = coll
                .delete_many(filter)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.deleteMany(...)"),
                result.deleted_count,
                "deleted",
            ))
        }
        MongoOp::ReplaceOne => {
            let filter = parse_filter(arg_or_empty(command, 0))?;
            let replacement = arg_document(command, 1, "replaceOne replacement document")?;
            let result = coll
                .replace_one(filter, replacement)
                .await
                .map_err(|error| error.to_string())?;
            Ok(write_outcome(
                format!("db.{name}.replaceOne(...)"),
                result.modified_count,
                "modified",
            ))
        }
    }
}

// Parses a JSON array of objects (insertMany's argument) into BSON documents. A non-array or a
// non-object element is a clear error. Extended JSON wrappers are validated.
fn parse_document_array(text: &str) -> Result<Vec<Document>, String> {
    let value: Value = serde_json::from_str(text.trim()).map_err(|error| error.to_string())?;
    validate_extended_json(&value)?;
    let Value::Array(items) = value else {
        return Err("insertMany requires a JSON array of documents".to_string());
    };
    items
        .into_iter()
        .map(|item| {
            if !item.is_object() {
                return Err("each insertMany element must be a JSON object".to_string());
            }
            json_object_to_document(item)
        })
        .collect()
}

// Command-facing Query-tab runner: splits the buffer into `;`-separated commands, runs each in
// order, returns one outcome per command (mirrors the SQL `run_query` shape). Cancellable by
// `request_id` via the shared cancel registry, so the Query tab's Run-becomes-Cancel works.
pub async fn run_query(
    connection_id: String,
    text: String,
    limit: u32,
    request_id: String,
) -> Result<Vec<QueryOutcome>, String> {
    let held = with_client(&connection_id)?;
    let token = crate::db::register_cancel_token(&request_id);
    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err(crate::db::CANCEL_SENTINEL.to_string()),
        result = run_commands(&held, &text, limit) => result,
    };
    crate::db::unregister_cancel_token(&request_id);
    result
}

async fn run_commands(
    held: &MongoConn,
    text: &str,
    limit: u32,
) -> Result<Vec<QueryOutcome>, String> {
    let commands = split_commands(text);
    if commands.is_empty() {
        return Ok(Vec::new());
    }
    let mut outcomes = Vec::with_capacity(commands.len());
    for command_text in commands {
        let command = parse_command(&command_text)?;
        outcomes.push(run_command(held, &command, limit).await?);
    }
    Ok(outcomes)
}

// Splits a buffer into individual commands on top-level `;`, leaving a `;` inside a string literal
// or a bracket/brace/paren group untouched (a JSON filter can carry both). Blank fragments dropped.
fn split_commands(text: &str) -> Vec<String> {
    let mut commands = Vec::new();
    let mut current = String::new();
    let mut depth: i32 = 0;
    let mut in_string: Option<char> = None;
    let mut previous = '\0';
    for character in text.chars() {
        match in_string {
            Some(quote) => {
                if character == quote && previous != '\\' {
                    in_string = None;
                }
            }
            None => match character {
                '"' | '\'' => in_string = Some(character),
                '(' | '[' | '{' => depth += 1,
                ')' | ']' | '}' => depth -= 1,
                ';' if depth == 0 => {
                    let trimmed = current.trim().to_string();
                    if !trimmed.is_empty() {
                        commands.push(trimmed);
                    }
                    current.clear();
                    previous = character;
                    continue;
                }
                _ => {}
            },
        }
        current.push(character);
        previous = character;
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        commands.push(trimmed);
    }
    commands
}

#[cfg(test)]
mod tests {
    use super::{
        build_cell_update, build_delete, build_insert, build_replace, bson_type_label,
        flatten_documents, is_connected, mongo_uri, parse_command, parse_filter, sample_fields,
        split_commands, MongoConfig, MongoOp,
    };
    use mongodb::bson::{doc, oid::ObjectId, Bson};
    use std::collections::BTreeMap;

    // behavior (a self-contained db.<coll>.find(<json>) command parses to collection + op + arg, so
    // the Query tab needs no collection picker - the collection lives in the text like SQL FROM)
    #[test]
    fn should_parse_a_find_command_with_its_collection() {
        let command = parse_command("db.users.find({ \"age\": { \"$gt\": 30 } })").expect("parse");
        assert_eq!(command.collection, "users");
        assert_eq!(command.op, MongoOp::Find);
        assert_eq!(command.args, vec!["{ \"age\": { \"$gt\": 30 } }".to_string()]);
    }

    // behavior (aggregate command + a quoted collection name + a trailing semicolon)
    #[test]
    fn should_parse_an_aggregate_command_and_a_quoted_collection() {
        let command =
            parse_command("db.\"order-items\".aggregate([{ \"$match\": {} }]);").expect("parse");
        assert_eq!(command.collection, "order-items");
        assert_eq!(command.op, MongoOp::Aggregate);
        assert_eq!(command.args, vec!["[{ \"$match\": {} }]".to_string()]);
    }

    // behavior (an empty find arg is allowed - it means match-all)
    #[test]
    fn should_parse_an_empty_find_arg() {
        let command = parse_command("db.events.find()").expect("parse");
        assert_eq!(command.collection, "events");
        assert!(command.args.is_empty());
    }

    // behavior (a write op parses its collection + op + both args split on the top-level comma)
    #[test]
    fn should_parse_an_update_one_with_filter_and_update() {
        let command = parse_command(
            "db.users.updateOne({ \"_id\": { \"$oid\": \"507f1f77bcf86cd799439011\" } }, { \"$set\": { \"age\": 99 } })",
        )
        .expect("parse");
        assert_eq!(command.collection, "users");
        assert_eq!(command.op, MongoOp::UpdateOne);
        assert_eq!(command.args.len(), 2);
        assert_eq!(
            command.args[0],
            "{ \"_id\": { \"$oid\": \"507f1f77bcf86cd799439011\" } }"
        );
        assert_eq!(command.args[1], "{ \"$set\": { \"age\": 99 } }");
    }

    // behavior (a comma inside a nested object/string does NOT split the args)
    #[test]
    fn should_not_split_args_on_a_nested_comma() {
        let command =
            parse_command("db.t.updateOne({ \"a\": 1, \"b\": 2 }, { \"$set\": { \"c\": 3 } })")
                .expect("parse");
        assert_eq!(command.args.len(), 2);
        assert_eq!(command.args[0], "{ \"a\": 1, \"b\": 2 }");
    }

    // behavior (malformed commands are clear errors, never panics)
    #[test]
    fn should_reject_malformed_commands() {
        assert!(parse_command("find({})").is_err(), "must start with db.");
        assert!(parse_command("db.users.remove({})").is_err(), "unsupported op");
        assert!(parse_command("db.users.find({}").is_err(), "missing close paren");
        assert!(parse_command("db..find({})").is_err(), "missing collection");
    }

    // behavior (the buffer splits on top-level ; only - a ; inside a string or brace group stays)
    #[test]
    fn should_split_commands_on_top_level_semicolons_only() {
        let split = split_commands("db.a.find({}); db.b.find({ \"x\": \"a;b\" })");
        assert_eq!(split.len(), 2);
        assert_eq!(split[0], "db.a.find({})");
        assert_eq!(split[1], "db.b.find({ \"x\": \"a;b\" })");

        // a brace group with a ; inside stays one command
        let one = split_commands("db.a.aggregate([{ \"$match\": { \"n\": 1 } }])");
        assert_eq!(one.len(), 1);
    }

    // TC-014 - behavior (the dispatch predicate is false for an id no Mongo client holds, so the
    // lib.rs dispatcher routes that id to the SQL path; a held id would route here)
    #[test]
    fn should_report_not_connected_for_an_unheld_id() {
        assert!(!is_connected("no-such-mongo-id"));
    }

    fn config() -> MongoConfig {
        MongoConfig {
            host: "localhost".to_string(),
            port: 27017,
            database: "shop".to_string(),
            user: "app_user".to_string(),
            password: "m0ngo-pw".to_string(),
            uri: None,
        }
    }

    // TC-004 - behavior (fields -> a mongodb:// URL)
    #[test]
    fn should_build_a_mongodb_url_from_the_discrete_fields() {
        assert_eq!(
            mongo_uri(&config()),
            "mongodb://app_user:m0ngo-pw@localhost:27017/shop"
        );
    }

    // TC-004, E-7 - behavior (special chars in credentials are percent-encoded)
    #[test]
    fn should_percent_encode_special_chars_in_mongo_credentials() {
        let cfg = MongoConfig {
            user: "p@ss:w/rd".to_string(),
            password: "p@ss:w/rd".to_string(),
            ..config()
        };
        let uri = mongo_uri(&cfg);
        assert!(!uri.contains("p@ss:w/rd"), "raw special chars leaked: {uri}");
        assert!(uri.contains("p%40ss%3Aw%2Frd"), "expected encoded creds: {uri}");
    }

    // TC-004, E-7 - behavior (an explicit uri overrides the fields verbatim)
    #[test]
    fn should_return_the_explicit_uri_verbatim_when_present() {
        let cfg = MongoConfig {
            uri: Some("mongodb+srv://u:p@cluster0.example.net/shop".to_string()),
            ..config()
        };
        assert_eq!(
            mongo_uri(&cfg),
            "mongodb+srv://u:p@cluster0.example.net/shop"
        );
    }

    // TC-004 - behavior (a blank uri does NOT override; the fields are used)
    #[test]
    fn should_ignore_a_blank_uri_and_use_the_fields() {
        let cfg = MongoConfig {
            uri: Some("   ".to_string()),
            ..config()
        };
        assert!(mongo_uri(&cfg).starts_with("mongodb://app_user:"));
    }

    // TC-005 - behavior (_id first; union of keys; nested -> compact JSON; scalar -> literal;
    // missing -> None)
    #[test]
    fn should_flatten_documents_with_id_first_and_nested_as_compact_json() {
        let documents = vec![
            doc! { "_id": "a", "name": "Ada", "address": { "city": "Wwa" }, "tags": ["x", "y"] },
            doc! { "_id": "b", "age": 41 },
        ];
        let (columns, rows) = flatten_documents(&documents);

        let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["_id", "name", "address", "tags", "age"]);

        // row 0: nested object + array shown as compact JSON; scalar string bare
        assert_eq!(rows[0][0], Some("a".to_string()));
        assert_eq!(rows[0][1], Some("Ada".to_string()));
        assert_eq!(rows[0][2], Some("{\"city\":\"Wwa\"}".to_string()));
        assert_eq!(rows[0][3], Some("[\"x\",\"y\"]".to_string()));
        assert_eq!(rows[0][4], None); // age missing in doc 0

        // row 1: name/address/tags missing -> None; age scalar -> literal
        assert_eq!(rows[1][1], None);
        assert_eq!(rows[1][4], Some("41".to_string()));
    }

    // behavior (sample_fields = union of top-level keys across docs, _id first, first-seen order)
    #[test]
    fn should_sample_the_union_of_top_level_fields_id_first() {
        let documents = vec![
            doc! { "_id": "a", "name": "Ada", "age": 1 },
            doc! { "_id": "b", "vip": true, "name": "Lin" },
        ];
        assert_eq!(
            sample_fields(&documents),
            vec!["_id", "name", "age", "vip"]
        );
        assert!(sample_fields(&[]).is_empty());
    }

    // E-3 - behavior (an empty collection still yields the _id column so the grid shows a header)
    #[test]
    fn should_yield_an_id_column_for_an_empty_collection() {
        let (columns, rows) = flatten_documents(&[]);
        assert_eq!(columns.len(), 1);
        assert_eq!(columns[0].name, "_id");
        assert!(columns[0].is_primary_key);
        assert!(rows.is_empty());
    }

    // TC-006 - behavior (_id is the primary key; type labels come from the sampled value)
    #[test]
    fn should_mark_id_as_primary_key_and_label_bson_types() {
        let documents = vec![doc! { "_id": "a", "age": 41i64, "vip": true }];
        let (columns, _) = flatten_documents(&documents);

        let id = &columns[0];
        assert_eq!(id.name, "_id");
        assert!(id.is_primary_key);

        assert_eq!(bson_type_label(&Bson::Int64(1)), "long");
        assert_eq!(bson_type_label(&Bson::Boolean(true)), "bool");
        assert_eq!(bson_type_label(&Bson::String("x".into())), "string");
        assert_eq!(
            bson_type_label(&Bson::Document(doc! { "a": 1 })),
            "object"
        );
        assert_eq!(bson_type_label(&Bson::Array(vec![])), "array");
    }

    // TC-007 - behavior (a valid JSON filter parses; empty -> match-all; bad JSON -> Err)
    #[test]
    fn should_parse_a_valid_json_filter_and_reject_bad_json() {
        let parsed = parse_filter("{\"age\": {\"$gt\": 30}}").expect("valid filter");
        assert_eq!(parsed, doc! { "age": { "$gt": 30i64 } });

        assert_eq!(parse_filter("   ").expect("empty"), doc! {});

        assert!(parse_filter("{not json").is_err());
        assert!(parse_filter("[1,2,3]").is_err(), "a non-object filter is rejected");
    }

    // behavior (Extended JSON $oid is parsed to a real ObjectId so an ObjectId _id can be queried;
    // query operators like $gt are left as plain keys, not mistaken for type wrappers)
    #[test]
    fn should_parse_extended_json_oid_in_a_filter() {
        let hex = "6a4185c4389537a2e1d1a7bb";
        let parsed = parse_filter(&format!("{{\"_id\": {{\"$oid\": \"{hex}\"}}}}"))
            .expect("oid filter");
        let expected = ObjectId::parse_str(hex).unwrap();
        assert_eq!(parsed, doc! { "_id": expected });

        // a query operator is NOT a type wrapper - it stays a normal nested document
        assert_eq!(
            parse_filter("{\"n\": {\"$gt\": 1}}").unwrap(),
            doc! { "n": { "$gt": 1i64 } }
        );

        // a malformed $oid (not 24-hex) is an error, not a silent string
        assert!(parse_filter("{\"_id\": {\"$oid\": \"nope\"}}").is_err());
    }

    // behavior ($numberLong / $numberInt / $numberDouble extended-JSON type wrappers parse to the
    // matching BSON number)
    #[test]
    fn should_parse_extended_json_number_wrappers() {
        assert_eq!(
            parse_filter("{\"a\": {\"$numberLong\": \"42\"}}").unwrap(),
            doc! { "a": 42i64 }
        );
        assert_eq!(
            parse_filter("{\"a\": {\"$numberInt\": \"7\"}}").unwrap(),
            doc! { "a": 7i32 }
        );
    }

    // TC-008 - behavior (cell update -> updateOne $set with the value as a JSON literal; _id locked)
    #[test]
    fn should_build_a_cell_update_parsing_the_value_as_a_json_literal() {
        let (filter, update) =
            build_cell_update("evt-login", "age", Some("42")).expect("update");
        assert_eq!(filter, doc! { "_id": "evt-login" });
        assert_eq!(update, doc! { "$set": { "age": 42i64 } });

        // a quoted string stays a string; bare text falls back to a string; true/null typed
        let (_, str_update) = build_cell_update("x", "name", Some("\"paid\"")).unwrap();
        assert_eq!(str_update, doc! { "$set": { "name": "paid" } });
        let (_, bare_update) = build_cell_update("x", "name", Some("paid")).unwrap();
        assert_eq!(bare_update, doc! { "$set": { "name": "paid" } });
        let (_, bool_update) = build_cell_update("x", "vip", Some("true")).unwrap();
        assert_eq!(bool_update, doc! { "$set": { "vip": true } });
        let (_, null_update) = build_cell_update("x", "note", None).unwrap();
        assert_eq!(null_update, doc! { "$set": { "note": Bson::Null } });

        assert!(build_cell_update("x", "_id", Some("y")).is_err(), "_id is locked");
    }

    // TC-009 - behavior (insert builds the doc from parsed values; delete builds the id filter;
    // an ObjectId-shaped _id matches as an ObjectId, a non-ObjectId by its value - E-4)
    #[test]
    fn should_build_insert_and_delete_resolving_object_ids() {
        let mut values: BTreeMap<String, Option<String>> = BTreeMap::new();
        values.insert("name".to_string(), Some("Ada".to_string()));
        values.insert("age".to_string(), Some("36".to_string()));
        values.insert("note".to_string(), None);
        assert_eq!(
            build_insert(&values),
            doc! { "age": 36i64, "name": "Ada", "note": Bson::Null }
        );

        // a 24-hex string parses as an ObjectId
        let oid = "65f0a1b2c3d4e5f600112233";
        let delete_oid = build_delete(oid);
        assert!(matches!(delete_oid.get("_id"), Some(Bson::ObjectId(_))));

        // a non-ObjectId _id matches by its raw value
        assert_eq!(build_delete("evt-login"), doc! { "_id": "evt-login" });
    }

    // TC-010 - behavior (replace builds replaceOne from the edited document JSON; non-object Err)
    #[test]
    fn should_build_a_replace_from_the_document_json() {
        let (filter, document) =
            build_replace("evt-login", "{\"_id\": \"evt-login\", \"kind\": \"login\"}")
                .expect("replace");
        assert_eq!(filter, doc! { "_id": "evt-login" });
        assert_eq!(document, doc! { "_id": "evt-login", "kind": "login" });

        assert!(build_replace("x", "[1,2,3]").is_err());
        assert!(build_replace("x", "not json").is_err());
    }

    // Live smoke against the seeded docker test-stack mongo (port 27018). Ignored by default so
    // CI / the normal suite never needs a running container; run explicitly with:
    //   cargo test --manifest-path src-tauri/Cargo.toml live_mongo -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_mongo_connects_lists_browses_and_counts() {
        use super::{connect, count_documents, fetch_documents, MongoConfig};

        // Empty discrete `database` + a URI carrying the db in its path - the real UI shape from the
        // screenshot. The URI's default_database must be used, not the blank field (regression).
        let config = MongoConfig {
            host: "localhost".to_string(),
            port: 27018,
            database: String::new(),
            user: "dbui".to_string(),
            password: "dbui".to_string(),
            uri: Some(
                "mongodb://dbui:dbui@localhost:27018/dbui_test?authSource=admin".to_string(),
            ),
        };
        let id = "live-test".to_string();

        let catalog = connect(id.clone(), config).await.expect("connect");
        let names: Vec<&str> = catalog.tables.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"users"), "collections: {names:?}");
        assert!(names.contains(&"orders"));
        assert!(names.contains(&"events"));

        let page = fetch_documents(id.clone(), "users".to_string(), 200, 0, None, None)
            .await
            .expect("browse users");
        assert_eq!(page.rows.len(), 200, "first page is the 200-row cap");
        assert_eq!(page.primary_key.as_deref(), Some("_id"));
        assert!(page.columns.iter().any(|c| c.name == "address"));

        let total = count_documents(id.clone(), "users".to_string(), None)
            .await
            .expect("count");
        assert_eq!(total, 500);

        // Query an ObjectId _id via Extended JSON $oid: take the first row's _id, filter by it, get
        // exactly one document back. Proves the $oid -> ObjectId path works against a live server.
        let first_id = page.rows[0][0].clone().expect("first _id");
        let one = count_documents(
            id.clone(),
            "users".to_string(),
            Some(format!("{{\"_id\": {{\"$oid\": \"{first_id}\"}}}}")),
        )
        .await
        .expect("oid filter count");
        assert_eq!(one, 1, "$oid filter must match exactly the one document");

        // A JSON find filter narrows the count.
        let filtered = count_documents(
            id.clone(),
            "users".to_string(),
            Some("{\"vip\": true}".to_string()),
        )
        .await
        .expect("filtered count");
        assert!(filtered > 0 && filtered < 500, "vip count: {filtered}");

        // events has disjoint field sets + a string _id; the column union must cover every key.
        let events = fetch_documents(id.clone(), "events".to_string(), 200, 0, None, None)
            .await
            .expect("browse events");
        let event_cols: Vec<&str> = events.columns.iter().map(|c| c.name.as_str()).collect();
        assert!(event_cols.contains(&"_id"));
        assert!(event_cols.contains(&"message"), "union covers disjoint keys: {event_cols:?}");

        // Query tab: a self-contained command (collection in the text) runs end-to-end. find with a
        // filter + a multi-command buffer + an aggregate, all via the SQL-shaped run_query.
        let outcomes = super::run_query(
            id.clone(),
            "db.users.find({ \"vip\": true }); db.orders.aggregate([{ \"$count\": \"n\" }])"
                .to_string(),
            200,
            "live-req".to_string(),
        )
        .await
        .expect("run_query");
        assert_eq!(outcomes.len(), 2, "two ;-separated commands -> two outcomes");
        assert!(outcomes[0].returns_rows && !outcomes[0].rows.is_empty());
        // $count yields a single { n: <total> } document.
        assert_eq!(outcomes[1].rows.len(), 1);

        // fetch_schema samples each collection's top-level fields for autocomplete.
        let schema = super::fetch_schema(id.clone()).await.expect("schema");
        let users = schema
            .iter()
            .find(|table| table.name == "users")
            .expect("users schema");
        let field_names: Vec<&str> =
            users.columns.iter().map(|c| c.name.as_str()).collect();
        assert!(field_names.contains(&"_id"));
        assert!(field_names.contains(&"address"), "fields: {field_names:?}");
        assert!(field_names.contains(&"tags"));

        // F6 #14 (AC-006): structure returns indexes only for a collection; every collection has at
        // least the `_id_` primary index, and columns/FK/constraints stay empty.
        let structure = super::fetch_table_structure(id.clone(), "users".to_string())
            .await
            .expect("structure");
        assert!(structure.columns.is_empty());
        assert!(structure.foreign_keys.is_empty());
        assert!(structure.constraints.is_empty());
        let id_index = structure
            .indexes
            .iter()
            .find(|index| index.name == "_id_")
            .expect("_id_ index");
        assert!(id_index.is_primary);

        super::disconnect(id).await;
    }

    // Live smoke of the Query-tab WRITE ops against the test-stack mongo: insert -> update -> read
    // back -> delete, all through the SQL-shaped run_query, into a scratch collection so seeded data
    // is untouched. Run: cargo test --manifest-path src-tauri/Cargo.toml live_mongo_write -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_mongo_write_round_trips_through_the_query_tab() {
        use super::MongoConfig;

        let config = MongoConfig {
            host: "localhost".to_string(),
            port: 27018,
            database: String::new(),
            user: "dbui".to_string(),
            password: "dbui".to_string(),
            uri: Some(
                "mongodb://dbui:dbui@localhost:27018/dbui_test?authSource=admin".to_string(),
            ),
        };
        let id = "live-write-test".to_string();
        super::connect(id.clone(), config).await.expect("connect");

        // Clean any leftover from a previous run.
        let _ = super::run_query(
            id.clone(),
            "db.dbui_scratch.deleteMany({})".to_string(),
            200,
            "w0".to_string(),
        )
        .await;

        // insertOne -> 1 inserted.
        let inserted = super::run_query(
            id.clone(),
            "db.dbui_scratch.insertOne({ \"_id\": \"w1\", \"age\": 1 })".to_string(),
            200,
            "w1".to_string(),
        )
        .await
        .expect("insert");
        assert_eq!(inserted[0].rows_affected, 1);
        assert!(!inserted[0].returns_rows);

        // updateOne -> 1 modified.
        let updated = super::run_query(
            id.clone(),
            "db.dbui_scratch.updateOne({ \"_id\": \"w1\" }, { \"$set\": { \"age\": 99 } })"
                .to_string(),
            200,
            "w2".to_string(),
        )
        .await
        .expect("update");
        assert_eq!(updated[0].rows_affected, 1, "one doc modified");

        // read back -> age is now 99.
        let read = super::run_query(
            id.clone(),
            "db.dbui_scratch.find({ \"_id\": \"w1\" })".to_string(),
            200,
            "w3".to_string(),
        )
        .await
        .expect("find");
        assert_eq!(read[0].rows.len(), 1);
        let age_col = read[0]
            .columns
            .iter()
            .position(|c| c == "age")
            .expect("age column");
        assert_eq!(read[0].rows[0][age_col].as_deref(), Some("99"));

        // deleteOne -> 1 deleted, collection empty again.
        let deleted = super::run_query(
            id.clone(),
            "db.dbui_scratch.deleteOne({ \"_id\": \"w1\" })".to_string(),
            200,
            "w4".to_string(),
        )
        .await
        .expect("delete");
        assert_eq!(deleted[0].rows_affected, 1);

        super::disconnect(id).await;
    }
}
