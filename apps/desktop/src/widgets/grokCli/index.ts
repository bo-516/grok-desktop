/**
 * grok CLI widget surface: the custom grok binary path form.
 * Upper layers import from `@/widgets/grokCli`, never the files inside.
 */

export {
  GrokBinSettingWidget,
  GrokCliSettingsSectionWidget,
} from "./GrokBinSettingWidget";
export type { GrokBinSettingWidgetProps } from "./GrokBinSettingWidget";
export { GrokBinSettingView } from "./GrokBinSettingView";
export type { GrokBinSettingViewProps } from "./GrokBinSettingView";
export { useGrokBinSettingWidget } from "./useGrokBinSettingWidget";
export type { GrokBinSettingWidgetState } from "./useGrokBinSettingWidget";
