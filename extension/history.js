const EMPTY_HISTORY = { pages: [], searches: [] };
const HISTORY_LIMIT = 250;
let historyWrite = Promise.resolve();

async function readHistory() {
  const result = await chrome.storage.local.get('rewindHistory');
  return result.rewindHistory ?? EMPTY_HISTORY;
}

function updateHistory(update) {
  const write = historyWrite.then(async () => {
    const history = update(await readHistory());
    await chrome.storage.local.set({ rewindHistory: history });
    return history;
  });
  historyWrite = write.catch(console.warn);
  return write;
}

function rememberPage(page) {
  const item = { title: page.title, url: RewindURLs.withoutHash(page.original), visited: Date.now() };
  return updateHistory(history => ({
    ...history,
    pages: [item, ...history.pages.filter(entry => entry.url !== item.url)].slice(0, HISTORY_LIMIT),
  }));
}

function rememberSearch(query) {
  const item = { query, visited: Date.now() };
  return updateHistory(history => ({
    ...history,
    searches: [item, ...history.searches.filter(entry => entry.query.toLowerCase() !== query.toLowerCase())].slice(0, HISTORY_LIMIT),
  }));
}
