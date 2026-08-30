/**
 * Runtime parameter validation for sprite-gen MCP tools.
 */
import { err, ErrorCode } from './result.js';

/**
 * Validate args against a schema. Returns null if valid, or an error result.
 * @param {object} args - the incoming arguments
 * @param {object} schema - { field: { type, required, min, max, enum, minLength, maxLength, minItems, maxItems } }
 */
export function validate(args, schema) {
  for (const [field, rules] of Object.entries(schema)) {
    const val = args[field];

    if (rules.required && (val === undefined || val === null || val === '')) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} is required`, { stage: 'validation' });
    }

    if (val === undefined || val === null) continue; // optional, skip

    if (rules.type === 'string' && typeof val !== 'string') {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be a string`, { stage: 'validation' });
    }
    if (rules.type === 'number' && typeof val !== 'number') {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be a number`, { stage: 'validation' });
    }
    if (rules.type === 'array' && !Array.isArray(val)) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be an array`, { stage: 'validation' });
    }
    if (rules.type === 'object' && (typeof val !== 'object' || Array.isArray(val))) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be an object`, { stage: 'validation' });
    }

    if (rules.enum && !rules.enum.includes(val)) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be one of: ${rules.enum.join(', ')}`, { stage: 'validation' });
    }
    if (rules.min != null && val < rules.min) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be >= ${rules.min}`, { stage: 'validation' });
    }
    if (rules.max != null && val > rules.max) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be <= ${rules.max}`, { stage: 'validation' });
    }
    if (rules.minLength != null && typeof val === 'string' && val.length < rules.minLength) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be at least ${rules.minLength} characters`, { stage: 'validation' });
    }
    if (rules.maxLength != null && typeof val === 'string' && val.length > rules.maxLength) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must be at most ${rules.maxLength} characters`, { stage: 'validation' });
    }
    if (rules.minItems != null && Array.isArray(val) && val.length < rules.minItems) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must have at least ${rules.minItems} items`, { stage: 'validation' });
    }
    if (rules.maxItems != null && Array.isArray(val) && val.length > rules.maxItems) {
      return err(ErrorCode.INVALID_ARGUMENT, `${field} must have at most ${rules.maxItems} items`, { stage: 'validation' });
    }
  }
  return null; // valid
}
