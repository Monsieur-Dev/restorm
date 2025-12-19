/**
 * Theme Types
 * Theme format definitions
 */
export interface TokenColorSettings {
    foreground?: string;
    background?: string;
    fontStyle?: string;
}
export interface TokenColor {
    name?: string;
    scope?: string | string[];
    settings: TokenColorSettings;
}
export type ThemeColors = Record<string, string>;
export type SemanticTokenColors = Record<string, string>;
export interface ThemeDefinition {
    $schema?: string;
    name: string;
    type?: 'dark' | 'light' | 'hc' | 'hcLight';
    include?: string;
    colors?: ThemeColors;
    tokenColors?: TokenColor[];
    semanticTokenColors?: SemanticTokenColors;
    semanticHighlighting?: boolean;
}
export interface ThemeInfo {
    id: string;
    name: string;
    type: 'dark' | 'light' | 'hc' | 'hcLight';
    path: string;
}
export type ThemeVariables = Record<string, string>;
//# sourceMappingURL=theme.d.ts.map
