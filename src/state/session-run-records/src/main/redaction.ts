import { MAX_OUTPUT } from "./domain.js";

export {
  formatError,
  redactValue,
  sanitizeErrorMessage,
} from "../../../../core/policy-redaction/src/main/redactor.ts";
import { truncateOutput } from "../../../../core/policy-redaction/src/main/redactor.ts";

export function truncateOutputForRunRecord(value: unknown, limit = MAX_OUTPUT): string {
  return truncateOutput(value, limit);
}

export { truncateOutputForRunRecord as truncateOutput };
