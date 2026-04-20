"use client";

import { useCallback, useMemo, useState } from "react";
import type { ZodIssue, ZodTypeAny, z } from "zod";

/**
 * Zero-dependency form helper built on Zod. Deliberately tiny — we don't want
 * to take a full `react-hook-form` dependency just to show field errors.
 *
 * Usage:
 *
 *   const schema = z.object({ username: usernameSchema, password: passwordSchema });
 *   const form = useZodForm(schema, { username: "", password: "" });
 *
 *   <input
 *     value={form.values.username}
 *     onChange={(e) => form.setField("username", e.target.value)}
 *     onBlur={() => form.touch("username")}
 *     aria-invalid={!!form.errors.username}
 *   />
 *   <FieldError message={form.errors.username} />
 *
 *   async function onSubmit(e) {
 *     e.preventDefault();
 *     const parsed = form.validate();
 *     if (!parsed.success) return; // field errors already set
 *     await api(parsed.data);
 *   }
 */
export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export interface UseZodFormResult<TSchema extends ZodTypeAny> {
  values: z.infer<TSchema>;
  errors: FieldErrors<z.infer<TSchema>>;
  touched: Partial<Record<keyof z.infer<TSchema>, boolean>>;
  setField: <K extends keyof z.infer<TSchema>>(
    key: K,
    value: z.infer<TSchema>[K],
  ) => void;
  setValues: (values: Partial<z.infer<TSchema>>) => void;
  touch: (key: keyof z.infer<TSchema>) => void;
  reset: (values?: Partial<z.infer<TSchema>>) => void;
  validate: () =>
    | { success: true; data: z.infer<TSchema> }
    | { success: false; errors: FieldErrors<z.infer<TSchema>> };
  isValid: boolean;
}

function issuesToFieldErrors<T>(issues: readonly ZodIssue[]): FieldErrors<T> {
  const out: FieldErrors<T> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (key === undefined) continue;
    if (out[key as keyof T]) continue; // keep the first error per field
    out[key as keyof T] = issue.message;
  }
  return out;
}

export function useZodForm<TSchema extends ZodTypeAny>(
  schema: TSchema,
  initialValues: z.infer<TSchema>,
): UseZodFormResult<TSchema> {
  type V = z.infer<TSchema>;

  const [values, setValuesState] = useState<V>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<V>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof V, boolean>>>({});

  const setField = useCallback(
    <K extends keyof V>(key: K, value: V[K]) => {
      setValuesState((prev) => ({ ...(prev as object), [key]: value }) as V);
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const setValues = useCallback((patch: Partial<V>) => {
    setValuesState((prev) => ({ ...(prev as object), ...(patch as object) }) as V);
  }, []);

  const touch = useCallback((key: keyof V) => {
    setTouched((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const reset = useCallback(
    (next?: Partial<V>) => {
      setValuesState({ ...(initialValues as object), ...((next ?? {}) as object) } as V);
      setErrors({});
      setTouched({});
    },
    [initialValues],
  );

  const validate = useCallback(() => {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return { success: true as const, data: result.data as V };
    }
    const fieldErrors = issuesToFieldErrors<V>(result.error.issues);
    setErrors(fieldErrors);
    // Mark everything touched so the UI displays errors next to each field.
    setTouched((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(fieldErrors) as (keyof V)[]) next[k] = true;
      return next;
    });
    return { success: false as const, errors: fieldErrors };
  }, [schema, values]);

  const isValid = useMemo(
    () => schema.safeParse(values).success,
    [schema, values],
  );

  return { values, errors, touched, setField, setValues, touch, reset, validate, isValid };
}
