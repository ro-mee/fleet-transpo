"use client";

import { useState, useCallback, useRef } from "react";
import { validatePayload, firstError, isValidObject } from "./helpers";

export function useFormValidation(schema) {
  const [errors, setErrors] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const fieldRefs = useRef({});

  const registerField = useCallback((name) => {
    return (el) => {
      if (el) fieldRefs.current[name] = el;
    };
  }, []);

  const validate = useCallback(
    (values, options = {}) => {
      const { onSuccess, onFailure } = options;
      const errs = validatePayload(values || {}, schema);
      setErrors(errs);
      setSubmitAttempted(true);
      if (isValidObject(errs)) {
        onSuccess?.();
        return true;
      }
      onFailure?.(errs);
      const first = firstError(errs);
      const firstKey = Object.keys(errs)[0];
      if (first && firstKey && fieldRefs.current[firstKey]) {
        fieldRefs.current[firstKey].focus?.();
        fieldRefs.current[firstKey].scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
      return false;
    },
    [schema]
  );

  const clearError = useCallback((name) => {
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }, []);

  const fieldError = useCallback(
    (name) => ({
      error: errors[name] || null,
      invalid: !!errors[name],
    }),
    [errors]
  );

  const resetValidation = useCallback(() => {
    setErrors({});
    setSubmitAttempted(false);
  }, []);

  return {
    errors,
    submitAttempted,
    validate,
    clearError,
    fieldError,
    registerField,
    resetValidation,
  };
}
