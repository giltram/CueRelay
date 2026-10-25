import type { ProjectStyle, ScriptSettings } from './styles';
export const testScript: ScriptSettings = { play_res_x: 640, play_res_y: 360, scaled_border_and_shadow: true };
export const testStyle = (name: string): ProjectStyle => ({ id: name, name, source_name: name, origin: null, fields: {
  Fontname: 'Test Font', Fontsize: '28', PrimaryColour: '&H00FFFFFF', SecondaryColour: '&H000000FF', OutlineColour: '&H00000000', BackColour: '&H80000000',
  Bold: '0', Italic: '0', Underline: '0', StrikeOut: '0', ScaleX: '100', ScaleY: '100', Spacing: '0', Angle: '0', BorderStyle: '1',
  Outline: '2', Shadow: '0', Alignment: '2', MarginL: '20', MarginR: '20', MarginV: '20', Encoding: '1',
} });
