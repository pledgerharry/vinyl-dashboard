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
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    Logger.log('Action: ' + action);
    if (action === 'addToCollection') return respond(addToCollection(body.record));
    if (action === 'removeFromCollection') return respond(removeFromCollection(body.artist, body.title));
    if (action === 'removeFromWishlist') return respond(removeFromWishlist(body.artist, body.title));
    if (action === 'addToWishlist') return respond(addToWishlist(body.record));
    if (action === 'undoCollection') return respond(undoCollection(body.artist, body.title, body.backToWishlist));
    if (action === 'bulkSync') return respond(bulkSync(body.toAdd, body.toUpdate, body.toRemove, body.wishToRemove));
    if (action === 'updatePrices') return respond(updatePrices(body.records));
    if (action === 'updateYear') return respond(updateYear(body.artist, body.title, body.year));
    if (action === 'updateOriginalYear') return respond(updateOriginalYear(body.artist, body.title, body.originalYear));
    if (action === 'bulkUpdateOriginalYears') return respond(bulkUpdateOriginalYears(body.records));
    if (action === 'ensureColumns') return respond(ensureOriginalYearColumn());
    if (action === 'test') return respond({ ok: true, message: 'Apps Script is working', time: new Date().toISOString() });
    return respond({ error: 'Unknown action: ' + action });
  } catch(err) {
    Logger.log('doPost error: ' + err.toString());
    return respond({ error: err.toString(), stack: err.stack });
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
  const cHeaders = cData[0];
  
  // Find column indices by header name so we're robust to column order
  const col = (name) => cHeaders.indexOf(name);
  
  const collection = cData.slice(1).filter(r => r[0]).map(r => ({
    artist:      r[col('artist')]      || '',
    title:       r[col('title')]       || '',
    year:        r[col('year')]        || '',
    value:       r[col('value')]       || 0,
    genre:       r[col('genre')]       || '',
    releaseId:   r[col('releaseId')]   || '',
    image:       r[col('image')]       || '',
    manualPrice: r[col('manualPrice')] || '',
    originalYear:r[col('originalYear')]|| ''
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

function updateOriginalYear(artist, title, originalYear) {
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  Logger.log('updateOriginalYear called: ' + artist + ' | ' + title + ' → ' + originalYear);
  Logger.log('Sheet headers: ' + JSON.stringify(headers));

  // Create originalYear column if it doesn't exist
  let origCol = headers.indexOf('originalYear');
  if (origCol === -1) {
    origCol = headers.length;
    sheet.getRange(1, origCol + 1).setValue('originalYear');
    Logger.log('Created originalYear at col ' + (origCol + 1));
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(artist) && String(data[i][1]) === String(title)) {
      sheet.getRange(i + 1, origCol + 1).setValue(originalYear);
      Logger.log('Written to row ' + (i + 1) + ' col ' + (origCol + 1));
      return { ok: true, row: i + 1, col: origCol + 1 };
    }
  }
  Logger.log('Row not found for: ' + artist + ' | ' + title);
  return { ok: false, note: 'Row not found', artist, title };
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

  // Guard — if core columns missing, sheet schema is wrong
  if (valCol === -1) return { ok: false, error: 'value column not found', headers };

  // Ensure manualPrice column exists
  let manualCol = headers.indexOf('manualPrice');
  if (manualCol === -1) {
    sheet.getRange(1, headers.length + 1).setValue('manualPrice');
    manualCol = headers.length;
  }

  const rowByRid = {};
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][ridCol] || '');
    const name = (String(data[i][artCol]||'')+'|'+String(data[i][titCol]||'')).toLowerCase();
    if (rid) rowByRid[rid] = i + 1;
    if (name) rowByName[name] = i + 1;
  }

  let updated = 0;
  (records || []).forEach(r => {
    const row = rowByRid[String(r.releaseId || '')] ||
                rowByName[(String(r.artist||'')+'|'+String(r.title||'')).toLowerCase()];
    if (!row) return;
    sheet.getRange(row, valCol + 1).setValue(Number(r.value));
    if (r.manual) sheet.getRange(row, manualCol + 1).setValue('manual');
    updated++;
  });

  return { ok: true, updated };
}

function bulkSync(toAdd, toUpdate, toRemove, wishToRemove) {
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const ridCol = headers.indexOf('releaseId');
  const artCol = headers.indexOf('artist');
  const titCol = headers.indexOf('title');

  const rowByRid = {};
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const rid = String(data[i][ridCol] || '');
    const name = (String(data[i][artCol]||'') + '|' + String(data[i][titCol]||'')).toLowerCase();
    if (rid) rowByRid[rid] = i + 1;
    if (name) rowByName[name] = i + 1;
  }

  // Remove rows in reverse order
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

  // Add new rows — skip duplicates
  let added = 0;
  (toAdd || []).forEach(r => {
    const nameKey = (String(r.artist||'') + '|' + String(r.title||'')).toLowerCase();
    if (rowByRid2[String(r.releaseId)] || rowByName2[nameKey]) return;
    sheet.appendRow([r.artist, r.title, r.year, r.value, r.genre, r.releaseId, r.image || '']);
    rowByName2[nameKey] = true;
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
  cSheet.getRange(1,1,1,9).setValues([['artist','title','year','value','genre','releaseId','image','manualPrice','originalYear']]);
  cSheet.setFrozenRows(1);
  
  let wSheet = ss.getSheetByName(WISHLIST_TAB);
  if (!wSheet) wSheet = ss.insertSheet(WISHLIST_TAB);
  wSheet.getRange(1,1,1,9).setValues([['artist','title','year','price','tier','spotify','genre','hmvNote','image']]);
  wSheet.setFrozenRows(1);
  
  return 'Sheets set up successfully';
}

// Ensure originalYear column exists without wiping data
function ensureOriginalYearColumn() {
  const sheet = getSheet(COLLECTION_TAB);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('originalYear') === -1) {
    sheet.getRange(1, headers.length + 1).setValue('originalYear');
  }
  if (headers.indexOf('manualPrice') === -1) {
    // insert manualPrice at col 8 if missing
    const mpIdx = headers.indexOf('manualPrice');
    if (mpIdx === -1) sheet.getRange(1, headers.length + 1).setValue('manualPrice');
  }
  return { ok: true };
}

// Bulk write originalYear for many records at once
function bulkUpdateOriginalYears(records) {
  if (!records || !records.length) return { ok: true, updated: 0 };
  const sheet = getSheet(COLLECTION_TAB);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const artCol = headers.indexOf('artist');
  const titCol = headers.indexOf('title');

  // Ensure originalYear column exists
  let origCol = headers.indexOf('originalYear');
  if (origCol === -1) {
    origCol = headers.length;
    sheet.getRange(1, origCol + 1).setValue('originalYear');
  }

  // Build lookup
  const rowByName = {};
  for (let i = 1; i < data.length; i++) {
    const name = (String(data[i][artCol]||'')+'|'+String(data[i][titCol]||'')).toLowerCase();
    rowByName[name] = i + 1;
  }

  // Batch write — collect all ranges and values, write in one call per row
  let updated = 0;
  records.forEach(r => {
    if (!r.originalYear) return;
    const row = rowByName[(String(r.artist||'')+'|'+String(r.title||'')).toLowerCase()];
    if (!row) return;
    // Only write if cell is currently empty (don't overwrite existing data)
    const current = sheet.getRange(row, origCol + 1).getValue();
    if (!current) {
      sheet.getRange(row, origCol + 1).setValue(r.originalYear);
      updated++;
    }
  });

  return { ok: true, updated };
}
