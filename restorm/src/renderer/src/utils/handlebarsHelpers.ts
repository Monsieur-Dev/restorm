/**
 * Handlebars Helpers Definitions Export (Renderer Process)
 * 
 * This file only re-exports the helper definitions for Monaco autocompletion.
 * Actual helper registration is now done in the main process.
 */

import Handlebars from 'handlebars'

export { Handlebars }

// Re-export helper definitions for Monaco autocompletion
export {
  handlebarsHelpersDefinitions,
  handlebarsHelperCategories,
  getHelpersByCategory,
  getTranslatedHelpers,
  type HandlebarsHelperDefinition,
  type HandlebarsHelperCategory,
  type TranslatedHelperDefinition
} from './handlebarsHelpersDefinitions'
