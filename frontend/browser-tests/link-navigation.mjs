// Explicitly exercise retained-workspace/history guards in one tab. Default
// new-tab behavior is verified separately by tab-navigation.mjs.
export async function sameTab(link) {
  await link.evaluate(element => { element.target = '_self'; });
  await link.click();
}
