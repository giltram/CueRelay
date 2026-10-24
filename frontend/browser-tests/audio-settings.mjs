/** Change the account preference through its actual new-tab settings UI. */
export async function setAudioMode(page, mode) {
  const popup = page.context().waitForEvent('page');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const settings = await popup;
  try {
    await settings.getByLabel('音频显示模式', { exact: true }).selectOption(mode);
    await settings.getByRole('button', { name: '保存显示设置', exact: true }).click();
    await settings.getByText('已保存', { exact: true }).waitFor();
  } catch (error) {
    console.error('Audio settings', settings.url(), await settings.locator('body').innerText());
    throw error;
  } finally { await settings.close(); }
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(expected => document.querySelector('.audio-timeline')?.dataset.mode === expected, mode);
}
