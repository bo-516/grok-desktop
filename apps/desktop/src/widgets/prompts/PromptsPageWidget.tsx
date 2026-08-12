/**
 * Stateful Rules & prompts page: three stacked scopes + inspect evidence bar.
 * Single store hook entry; views stay pure.
 */

import { PromptsPageBodyView } from "./PromptsPageBodyView";
import { usePromptsWidget } from "./usePromptsWidget";

/**
 * Environment sheet `rules` page body.
 * @returns Three-scope editor + evidence strip.
 */
export function PromptsPageWidget() {
  const model = usePromptsWidget();
  return <PromptsPageBodyView model={model} />;
}
