import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";

type DemoFormValues = {
  connectionUrl: string;
};

export function DemoForm() {
  const [submitted, setSubmitted] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { connectionUrl: "" } as DemoFormValues,
    onSubmit: ({ value }) => {
      setSubmitted(value.connectionUrl);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
      className="flex flex-col gap-2 max-w-sm"
    >
      <form.Field
        name="connectionUrl"
        validators={{
          onChange: ({ value }) =>
            value.trim().length === 0
              ? "Connection URL is required"
              : undefined,
        }}
      >
        {(field) => (
          <div className="flex flex-col gap-1">
            <label htmlFor={field.name} className="text-sm font-medium">
              Connection URL
            </label>
            <input
              id={field.name}
              name={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              className="h-9 rounded-md border px-3 text-sm"
              placeholder="postgres://localhost:5432/mydb"
            />
            {field.state.meta.errors.length > 0 ? (
              <p role="alert" className="text-sm text-destructive">
                {String(field.state.meta.errors[0])}
              </p>
            ) : null}
          </div>
        )}
      </form.Field>

      <Button type="submit" className="self-start">
        Save connection
      </Button>

      {submitted ? (
        <p
          data-testid="form-submitted"
          className="text-sm text-muted-foreground"
        >
          Saved: {submitted}
        </p>
      ) : null}
    </form>
  );
}
