/** Download bytes immediately, but defer main-thread JSON parsing until a
 * presentation barrier (such as the opening animation) has completed. */
export async function loadJSON(url, { beforeParse, optional = false } = {}) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${response.status}`);
    const text = await response.text();
    await beforeParse;
    return JSON.parse(text);
  } catch (error) {
    if (optional) return null;
    throw error;
  }
}
