// ═══════════════════════════════════════════════════════════════
// VINYL DASHBOARD — Google Apps Script Backend
// Paste this entire file into Google Apps Script and deploy as
// a web app. See SETUP.md for full instructions.
// ═══════════════════════════════════════════════════════════════

const SHEET_ID = '1iZdgwO_Ch4pUjAluz2XT1V9YzjPbcjNd0XZ3svotJuk';
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
    if (action === 'removeFromCollection') return respond(removeFromCollection(body.artist, body.title));
    if (action === 'removeFromWishlist') return respond(removeFromWishlist(body.artist, body.title));
    if (action === 'addToWishlist') return respond(addToWishlist(body.record));
    if (action === 'undoCollection') return respond(undoCollection(body.artist, body.title, body.backToWishlist));
    if (action === 'bulkSync') return respond(bulkSync(body.toAdd, body.toUpdate, body.toRemove, body.wishToRemove));
    if (action === 'updatePrices') return respond(updatePrices(body.records));
    if (action === 'updateYear') return respond(updateYear(body.artist, body.title, body.year));
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

function removeFromCollection(artist, title) {
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] === artist && data[i][1] === title) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: true, note: 'Row not found' };
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

function updateYear(artist, title, year) {
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(artist) && String(data[i][1]) === String(title)) {
      sheet.getRange(i + 1, 3).setValue(year);
      return { ok: true };
    }
  }
  return { ok: false, note: 'Row not found' };
}

function updatePrices(records) {
  if (!records || !records.length) return { ok: true, updated: 0 };
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const ridCol = headers.indexOf('releaseId');
  const artCol = headers.indexOf('artist');
  const titCol = headers.indexOf('title');
  const valCol = headers.indexOf('value');

  // Ensure there's a manualPrice column (column 8, index 7)
  let manualCol = headers.indexOf('manualPrice');
  if (manualCol === -1) {
    // Add header if missing
    sheet.getRange(1, headers.length + 1).setValue('manualPrice');
    manualCol = headers.length;
  }

  const rowByRid = {};
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][ridCol] || '');
    const name = (String(data[i][artCol]||'')+'|'+String(data[i][titCol]||'')).toLowerCase();
    if (rid) rowByRid[rid] = i + 1;
    rowByName[name] = i + 1;
  }

  let updated = 0;
  (records || []).forEach(r => {
    const row = rowByRid[String(r.releaseId || '')] ||
                rowByName[(String(r.artist||'')+'|'+String(r.title||'')).toLowerCase()];
    if (!row) return;
    sheet.getRange(row, valCol + 1).setValue(r.value);
    if (r.manual) sheet.getRange(row, manualCol + 1).setValue('manual');
    updated++;
  });

  return { ok: true, updated };
}


  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const ridCol = headers.indexOf('releaseId');
  const artCol = headers.indexOf('artist');
  const titCol = headers.indexOf('title');

  // Build maps of existing rows by releaseId and by artist|title
  const rowByRid = {};
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][ridCol] || '');
    const name = (String(data[i][artCol]||'') + '|' + String(data[i][titCol]||'')).toLowerCase();
    if (rid) rowByRid[rid] = i + 1;
    if (name) rowByName[name] = i + 1;
  }

  // Remove — delete rows in reverse order
  const removeRids = (toRemove || []).map(r => String(r.releaseId));
  const rowsToDelete = removeRids.map(rid => rowByRid[rid]).filter(Boolean).sort((a,b) => b-a);
  rowsToDelete.forEach(row => sheet.deleteRow(row));

  // Re-read after deletions
  const data2 = sheet.getDataRange().getValues();
  const rowByRid2 = {};
  const rowByName2 = {};
  for (let i = 1; i < data2.length; i++) {
    const rid = String(data2[i][ridCol] || '');
    const name = (String(data2[i][artCol]||'') + '|' + String(data2[i][titCol]||'')).toLowerCase();
    if (rid) rowByRid2[rid] = i + 1;
    if (name) rowByName2[name] = i + 1;
  }

  // Update existing rows
  (toUpdate || []).forEach(r => {
    const row = rowByRid2[String(r.releaseId)];
    if (!row) return;
    sheet.getRange(row, 1, 1, 7).setValues([[
      r.artist, r.title, r.year, r.value, r.genre, r.releaseId, r.image || ''
    ]]);
  });

  // Add new rows — skip any that already exist by releaseId or artist|title
  let added = 0;
  (toAdd || []).forEach(r => {
    const nameKey = (String(r.artist||'') + '|' + String(r.title||'')).toLowerCase();
    if (rowByRid2[String(r.releaseId)] || rowByName2[nameKey]) return; // already exists
    sheet.appendRow([r.artist, r.title, r.year, r.value, r.genre, r.releaseId, r.image || '']);
    rowByName2[nameKey] = true; // prevent double-add within same batch
    added++;
  });

  // Remove from wishlist anything now in collection
  if (wishToRemove && wishToRemove.length) {
    const wSheet = getSheet(WISHLIST_TAB);
    const wData = wSheet.getDataRange().getValues();
    const wHeaders = wData[0];
    const wArt = wHeaders.indexOf('artist');
    const wTit = wHeaders.indexOf('title');
    const wRowsToDelete = [];
    wishToRemove.forEach(w => {
      for (let i = 1; i < wData.length; i++) {
        const wa = String(wData[i][wArt]||'').toLowerCase();
        const wt = String(wData[i][wTit]||'').toLowerCase();
        if (wa === String(w.artist||'').toLowerCase() && wt === String(w.title||'').toLowerCase()) {
          wRowsToDelete.push(i + 1);
        }
      }
    });
    wRowsToDelete.sort((a,b) => b-a).forEach(row => wSheet.deleteRow(row));
  }

  return { ok: true, added, updated: (toUpdate||[]).length, removed: rowsToDelete.length };
}
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
