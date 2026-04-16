// ═══════════════════════════════════════════════════════════════
// VINYL DASHBOARD — Google Apps Script Backend
// Paste this entire file into Google Apps Script and deploy as
// a web app. See SETUP.md for full instructions.
// ═══════════════════════════════════════════════════════════════

const SHEET_ID = 'YOUR_SHEET_ID_HERE'; // Replace with your Google Sheet ID
const COLLECTION_TAB = 'collection';
const WISHLIST_TAB = 'wishlist';

function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'read') return respond(readAll());
    return respond({ error: 'Unknown action' });
  } catch(err) {
    return respond({ error: err.toString() });
  }
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  try {
    if (action === 'addToCollection') return respond(addToCollection(body.record));
    if (action === 'removeFromWishlist') return respond(removeFromWishlist(body.artist, body.title));
    if (action === 'addToWishlist') return respond(addToWishlist(body.record));
    if (action === 'undoCollection') return respond(undoCollection(body.artist, body.title, body.backToWishlist));
    return respond({ error: 'Unknown action' });
  } catch(err) {
    return respond({ error: err.toString() });
  }
}

function respond(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(tab) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(tab);
}

function readAll() {
  const cSheet = getSheet(COLLECTION_TAB);
  const wSheet = getSheet(WISHLIST_TAB);
  
  const cData = cSheet.getDataRange().getValues();
  const wData = wSheet.getDataRange().getValues();
  
  // Skip header row
  const collection = cData.slice(1).filter(r => r[0]).map(r => ({
    artist: r[0], title: r[1], year: r[2], value: r[3],
    genre: r[4], releaseId: r[5] || '', image: r[6] || ''
  }));
  
  const wishlist = wData.slice(1).filter(r => r[0]).map(r => ({
    artist: r[0], title: r[1], year: r[2], price: r[3],
    tier: r[4], spotify: r[5], genre: r[6], hmvNote: r[7],
    image: r[8] || ''
  }));
  
  return { collection, wishlist };
}

function addToCollection(record) {
  const sheet = getSheet(COLLECTION_TAB);
  sheet.appendRow([
    record.artist, record.title, record.year, record.value,
    record.genre, record.releaseId || '', record.image || ''
  ]);
  return { ok: true };
}

function removeFromWishlist(artist, title) {
  const sheet = getSheet(WISHLIST_TAB);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === artist && data[i][1] === title) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: true, note: 'Row not found' };
}

function addToWishlist(record) {
  const sheet = getSheet(WISHLIST_TAB);
  sheet.appendRow([
    record.artist, record.title, record.year, record.price,
    record.tier || 'store', record.spotify || false,
    record.genre, record.hmvNote || 'nothmv', record.image || ''
  ]);
  return { ok: true };
}

function undoCollection(artist, title, backToWishlist) {
  // Remove from collection
  const cSheet = getSheet(COLLECTION_TAB);
  const cData = cSheet.getDataRange().getValues();
  for (let i = cData.length - 1; i >= 1; i--) {
    if (cData[i][0] === artist && cData[i][1] === title) {
      cSheet.deleteRow(i + 1);
      break;
    }
  }
  // Add back to wishlist if needed
  if (backToWishlist) {
    addToWishlist(backToWishlist);
  }
  return { ok: true };
}

// ── Initial data setup ─────────────────────────────────────────
// Run this ONCE to create the sheet headers. Do not run again.
function setupSheets() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  
  let cSheet = ss.getSheetByName(COLLECTION_TAB);
  if (!cSheet) cSheet = ss.insertSheet(COLLECTION_TAB);
  cSheet.getRange(1,1,1,7).setValues([['artist','title','year','value','genre','releaseId','image']]);
  cSheet.setFrozenRows(1);
  
  let wSheet = ss.getSheetByName(WISHLIST_TAB);
  if (!wSheet) wSheet = ss.insertSheet(WISHLIST_TAB);
  wSheet.getRange(1,1,1,9).setValues([['artist','title','year','price','tier','spotify','genre','hmvNote','image']]);
  wSheet.setFrozenRows(1);
  
  return 'Sheets set up successfully';
}
