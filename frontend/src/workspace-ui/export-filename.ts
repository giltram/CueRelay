/** Use local export time and a filesystem-safe project name. */
export function subtitleExportFilename(projectName?: string, exportedAt = new Date()): string {
  const name = projectName?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().replace(/[. ]+$/, '').slice(0, 80) || 'cuerelay';
  const pad = (value: number) => String(value).padStart(2, '0');
  const date = `${exportedAt.getFullYear()}-${pad(exportedAt.getMonth() + 1)}-${pad(exportedAt.getDate())}`;
  const time = `${pad(exportedAt.getHours())}-${pad(exportedAt.getMinutes())}-${pad(exportedAt.getSeconds())}`;
  return `${name}_${date}_${time}.ass`;
}
