export type StyleField = 'Fontname' | 'Fontsize' | 'PrimaryColour' | 'SecondaryColour' | 'OutlineColour' | 'BackColour'
  | 'Bold' | 'Italic' | 'Underline' | 'StrikeOut' | 'ScaleX' | 'ScaleY' | 'Spacing' | 'Angle' | 'BorderStyle'
  | 'Outline' | 'Shadow' | 'Alignment' | 'MarginL' | 'MarginR' | 'MarginV' | 'Encoding';
export type StyleFields = Record<StyleField, string>;
export interface ScriptSettings { play_res_x: number | null; play_res_y: number | null; scaled_border_and_shadow: boolean | null }
export interface ProjectStyle {
  id: string; name: string; fields: StyleFields; source_name: string | null;
  origin: { template_id: string; revision: number } | null;
}
export interface StyleTemplate {
  id: string; name: string; fields: StyleFields; reference: ScriptSettings; source_label: string;
  revision: number; created_at: string; updated_at: string; updated_by: { username: string };
}
export type TemplateInput = Pick<StyleTemplate, 'name' | 'fields' | 'reference' | 'source_label'>;
export type ImportStyle = { type: 'import'; template_id: string; revision: number; name: string; mode: 'copy' | 'scale' };
export type StyleOperation =
  | { type: 'create'; name: string; fields: StyleFields }
  | { type: 'update' | 'copy'; id: string; name: string; fields: Partial<StyleFields> }
  | { type: 'batch'; ids: string[]; fields: Partial<StyleFields> }
  | { type: 'delete'; ids: string[] }
  | { type: 'assign'; cue_ids: string[]; style_id: string }
  | { type: 'script'; script: ScriptSettings }
  | ImportStyle;
export type StyleUsage = Record<string, { cues: number; comments: number }>;
