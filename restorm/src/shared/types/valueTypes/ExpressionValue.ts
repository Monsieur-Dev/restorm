import { StringBackedValue } from './BaseValueType'

/**
 * String-backed value whose template is resolved by Handlebars when the
 * runtime walks the variables chain. Plain `StringValue`s stay literal:
 * any `{{var}}` they contain is preserved as-is.
 *
 * Use this for env variables like `baseUrl`
 * (`{{scheme}}://{{host}}:{{port}}{{baseRoute}}`) where the value is
 * meant to be a template, and keep the raw scheme / host / port pieces
 * as their own native types (`StringValue`, `NumericValue`, …).
 */
export class ExpressionValue extends StringBackedValue {
  readonly type = 'expression' as const
}
