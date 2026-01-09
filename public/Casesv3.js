// =========================
// Global: disable printing
// =========================

// Disable common print shortcuts (Ctrl+P on Windows/Linux and Cmd+P on macOS/iOS)
document.addEventListener('keydown', function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
    event.preventDefault();
    alert("Printing is disabled on this page.");
  }
});

// Optionally, intercept the print event itself (may not work on all browsers)
window.onbeforeprint = function () {
  document.body.style.display = "none";
};
window.onafterprint = function () {
  document.body.style.display = "block";
};

// =========================
// Shared helpers
// =========================

function getAirtableRecordsOrExit(contextLabel) {
  const records = window.airtableData;
  if (!records || records.length === 0) {
    console.error(`No records found or failed to fetch records (${contextLabel}).`);
    return null;
  }
  return records;
}

// Simple value collector, sorted by 'Order'
function collectAndSortValues(records, fieldName) {
  const values = [];
  for (const record of records) {
    const order = record.fields['Order'];
    const value = record.fields[fieldName];
    if (value && order !== undefined) {
      values.push({ order, value });
    }
  }
  values.sort((a, b) => a.order - b.order);
  return values.map(item => item.value);
}

// Keyed collector (keeps order + value objects)
function collectAndSortKeyed(records, fieldName) {
  const values = [];
  for (const record of records) {
    const order = record.fields['Order'];
    const value = record.fields[fieldName];
    if (value && order !== undefined) {
      values.push({ order, value });
    }
  }
  values.sort((a, b) => a.order - b.order);
  return values;
}

// =========================
// Candidate Instructions
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Candidate Instructions – Patient data/notes/results');
  if (!records) return;

  // ---- Patient basic data ----
  (function populatePatientData() {
    const names = collectAndSortValues(records, 'Name');
    const ages = collectAndSortValues(records, 'Age');
    const pmHx = collectAndSortValues(records, 'PMHx Record');
    const dHx = collectAndSortValues(records, 'DHx');

    const nameEl = document.getElementById('patientName');
    const ageEl = document.getElementById('patientAge');
    const pmHxList = document.getElementById('patientPMHx');
    const dHxList = document.getElementById('patientDHx');

    if (nameEl) nameEl.textContent = names.join(', ') || 'N/A';
    if (ageEl) ageEl.textContent = ages.join(', ') || 'N/A';

    if (pmHxList) {
      pmHxList.innerHTML = '';
      pmHx.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        pmHxList.appendChild(li);
      });
    }

    if (dHxList) {
      dHxList.innerHTML = '';
      dHx.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        dHxList.appendChild(li);
      });
    }
  })();

  // ---- Medical notes (with images) ----
  (function populateMedicalNotes() {
    const medicalNotes = collectAndSortValues(records, 'Medical Notes');
    const medicalNotesContent = collectAndSortValues(records, 'Medical Notes Content');
    const medicalNotesPhotos = collectAndSortValues(records, 'Notes Photo');

    const medicalNotesDiv = document.getElementById('medicalNotes');
    if (!medicalNotesDiv) return;
    medicalNotesDiv.innerHTML = '';

    for (let i = 0; i < medicalNotes.length; i++) {
      const note = medicalNotes[i];
      const content = medicalNotesContent[i] || '';
      const photos = medicalNotesPhotos[i]; // array of attachments for this note

      const noteElement = document.createElement('div');
      const contentElement = document.createElement('div');

      noteElement.classList.add('underline');
      contentElement.classList.add('quote-box', 'quote-box-medical');

      noteElement.textContent = (i > 0 ? '\n' : '') + note;
      contentElement.innerHTML = content.replace(/\n/g, '<br>') + '<br>';

      medicalNotesDiv.appendChild(noteElement);
      medicalNotesDiv.appendChild(contentElement);

      // Attach images if present
      if (photos && Array.isArray(photos) && photos.length > 0) {
        photos.forEach(photo => {
          if (!photo || !photo.url) return;
          const imgElement = document.createElement('img');
          imgElement.src = photo.url;
          imgElement.alt = 'Medical Notes Image';
          imgElement.style.width = '100%';
          imgElement.style.maxWidth = '800px';
          imgElement.style.height = 'auto';
          imgElement.style.display = 'block';
          imgElement.style.margin = '10px auto';
          medicalNotesDiv.appendChild(imgElement);
        });
      }
    }
  })();

  // ---- Results ----
  (function populateResults() {
    const results = collectAndSortValues(records, 'Results');
    const resultsContent = collectAndSortValues(records, 'Results Content');

    const resultsContentDiv = document.getElementById('resultsContent');
    if (!resultsContentDiv) return;
    resultsContentDiv.innerHTML = '';

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const content = resultsContent[i] || '';

      const resultElement = document.createElement('div');
      const contentElement = document.createElement('div');

      resultElement.classList.add('underline');
      contentElement.classList.add('quote-box', 'quote-box-results');

      resultElement.textContent = (i > 0 ? '\n' : '') + result;
      contentElement.innerHTML = content.replace(/\n/g, '<br>') + '<br>';

      resultsContentDiv.appendChild(resultElement);
      resultsContentDiv.appendChild(contentElement);
    }
  })();
});

// =========================
// Doctor Instructions
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Doctor Instructions');
  if (!records) return;

  // ---- Instructions & opening sentence ----
  (function populatePatientData() {
    const instructions = collectAndSortValues(records, 'Instructions').join('<br>');
    const openingSentence = collectAndSortValues(records, 'Opening Sentence').join('<br>');

    const instructionsEl = document.getElementById('instructions');
    const openingEl = document.getElementById('openingSentence');

    if (instructionsEl) instructionsEl.innerHTML = instructions;
    if (openingEl) openingEl.innerHTML = openingSentence;
  })();

  // ---- History sections ----
  (function populateHistoryData() {
    const openHistory = collectAndSortValues(records, 'Divulge Freely');
    const historyIfAsked = collectAndSortValues(records, 'Divulge Asked');
    const socialHistory = collectAndSortValues(records, 'Social History');
    const pastMedicalHistory = collectAndSortValues(records, 'PMHx RP');
    const familyHistory = collectAndSortValues(records, 'Family History');

    const openHistoryDiv = document.getElementById('openHistory');
    const historyIfAskedDiv = document.getElementById('historyIfAsked');
    const socialHistoryList = document.getElementById('socialHistory');
    const pastMedicalHistoryList = document.getElementById('pastMedicalHistory');
    const familyHistoryList = document.getElementById('familyHistory');

    if (openHistoryDiv) {
      openHistoryDiv.innerHTML = '';
      openHistory.forEach(item => {
        const p = document.createElement('p');
        p.classList.add('paragraph');
        p.textContent = item;
        openHistoryDiv.appendChild(p);
      });
    }

    if (historyIfAskedDiv) {
      historyIfAskedDiv.innerHTML = '';
      historyIfAsked.forEach(item => {
        const p = document.createElement('p');
        p.classList.add('paragraph');
        p.textContent = item;
        historyIfAskedDiv.appendChild(p);
      });
    }

    if (socialHistoryList) {
      socialHistoryList.innerHTML = '';
      socialHistory.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        socialHistoryList.appendChild(li);
      });
    }

    if (pastMedicalHistoryList) {
      pastMedicalHistoryList.innerHTML = '';
      pastMedicalHistory.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        pastMedicalHistoryList.appendChild(li);
      });
    }

    if (familyHistoryList) {
      familyHistoryList.innerHTML = '';
      familyHistory.forEach(item => {
        const li = document.createElement('li');
        li.textContent = item;
        familyHistoryList.appendChild(li);
      });
    }
  })();

  // ---- ICE ----
  (function populateICEData() {
    const iceData = collectAndSortValues(records, 'ICE');
    const ideas = iceData[0];
    const concerns = iceData[1];
    const expectations = iceData[2];

    const ideasEl = document.getElementById('ideas');
    const concernsEl = document.getElementById('concerns');
    const expectationsEl = document.getElementById('expectations');

    if (ideasEl) ideasEl.innerHTML = ideas || '';
    if (concernsEl) concernsEl.innerHTML = concerns || '';
    if (expectationsEl) expectationsEl.innerHTML = expectations || '';
  })();

  // ---- Reaction ----
  (function populateReactionData() {
    const reactions = collectAndSortValues(records, 'Reaction');
    const reactionContentDiv = document.getElementById('reactionContent');
    if (!reactionContentDiv) return;

    reactionContentDiv.innerHTML = '';
    reactions.forEach(reaction => {
      const reactionElement = document.createElement('div');
      reactionElement.classList.add('reaction-item');
      reactionElement.textContent = reaction;
      reactionContentDiv.appendChild(reactionElement);
    });
  })();
});

// =========================
// Marking
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Marking');
  if (!records) return;

  const ORDER_FIELD_NAME = 'Order';

  function populateCriteriaLists(section, positiveFieldName, negativeFieldName) {
    const validRecords = records.filter(record =>
      record.fields[positiveFieldName] || record.fields[negativeFieldName]
    );

    validRecords.sort((a, b) => a.fields[ORDER_FIELD_NAME] - b.fields[ORDER_FIELD_NAME]);

    const positiveList = document.getElementById(`${section}PositiveList`);
    const negativeList = document.getElementById(`${section}NegativeList`);

    if (!positiveList || !negativeList) return;

    validRecords.forEach((record, index) => {
      if (record.fields[positiveFieldName]) {
        const positiveItems = Array.isArray(record.fields[positiveFieldName])
          ? record.fields[positiveFieldName]
          : [record.fields[positiveFieldName]];
        positiveItems.forEach(positiveItem => {
          const li = document.createElement('li');
          li.classList.add('criteria-item');
          li.innerHTML = `
            <input type="checkbox" id="${section}Positive${index + 1}" onchange="updateScore('${section}', ${index + 1})">
            <label for="${section}Positive${index + 1}" class="positive">${positiveItem}</label>
          `;
          positiveList.appendChild(li);
        });
      }
      if (record.fields[negativeFieldName]) {
        const negativeItems = Array.isArray(record.fields[negativeFieldName])
          ? record.fields[negativeFieldName]
          : [record.fields[negativeFieldName]];
        negativeItems.forEach(negativeItem => {
          const li = document.createElement('li');
          li.classList.add('criteria-item');
          li.innerHTML = `
            <input type="checkbox" id="${section}Negative${index + 1}" onchange="updateScore('${section}', -${index + 1})">
            <label for="${section}Negative${index + 1}" class="negative">${negativeItem}</label>
          `;
          negativeList.appendChild(li);
        });
      }
    });
  }

  populateCriteriaLists('clinicalManagement', 'CM positive', 'CM negative');
  populateCriteriaLists('relatingToOthers', 'RTO positive', 'RTO negative');
  populateCriteriaLists('dataGathering', 'DG positive', 'DG negative');
});

// Define updateScore in the global scope
function updateScore(section, index) {
  const positiveList = document.querySelectorAll(`#${section}PositiveList .criteria-item input[type="checkbox"]`);
  const negativeList = document.querySelectorAll(`#${section}NegativeList .criteria-item input[type="checkbox"]`);

  if (!positiveList.length || !negativeList.length) return;

  // Mutual exclusivity
  if (index > 0) {
    if (positiveList[index - 1].checked) {
      negativeList[index - 1].checked = false;
    } else {
      negativeList[index - 1].checked = true;
    }
  } else {
    if (negativeList[-index - 1].checked) {
      positiveList[-index - 1].checked = false;
    } else {
      positiveList[-index - 1].checked = true;
    }
  }

  let score = 0;
  const topThreeCriteriaCount = 3;

  positiveList.forEach((checkbox, idx) => {
    if (checkbox.checked) {
      if (idx < topThreeCriteriaCount) {
        score += 2;
      } else {
        score += 1;
      }
    }
  });

  const scoreEl = document.getElementById(`${section}Score`);
  if (scoreEl) {
    scoreEl.innerText = `Score: ${score}`;
  }

  const resultElement = document.getElementById(`${section}Result`);
  if (!resultElement) return;

  let result = "";
  const maxScore = topThreeCriteriaCount * 2 + (positiveList.length - topThreeCriteriaCount) * 1;
  const percentage = (score / maxScore) * 100;

  resultElement.classList.remove('clear-pass', 'borderline-pass', 'borderline-fail', 'clear-fail', 'start-marking');

  if (percentage <= 25) {
    result = "Clear Fail";
    resultElement.classList.add('clear-fail');
  } else if (percentage <= 50) {
    result = "Borderline Fail";
    resultElement.classList.add('borderline-fail');
  } else if (percentage <= 75) {
    result = "Borderline Pass";
    resultElement.classList.add('borderline-pass');
  } else {
    result = "Clear Pass";
    resultElement.classList.add('clear-pass');
  }

  resultElement.innerText = result;
}

// =========================
// Key Issues
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Key Issues');
  if (!records) return;

  const keyIssues = collectAndSortKeyed(records, 'Key Issues');
  const keyIssuesRelevance = collectAndSortKeyed(records, 'Key Issues Relevance');
  const keyIssuesMapping = collectAndSortKeyed(records, 'Key Issues Mapping');

  const keyIssuesDiv = document.getElementById('keyIssuesContent');
  if (!keyIssuesDiv) return;

  keyIssuesDiv.innerHTML = '';

  const totalIssues = keyIssues.length;

  for (let i = 0; i < totalIssues; i++) {
    const issueOrder = keyIssues[i].order;
    const issue = keyIssues[i].value;
    const relevance = keyIssuesRelevance.find(item => item.order === issueOrder)?.value || '';
    const mapping = keyIssuesMapping.find(item => item.order === issueOrder)?.value || '';

    const issueElement = document.createElement('div');
    issueElement.classList.add('bold-dark-green');
    issueElement.innerHTML = `<br>${issue}`;
    keyIssuesDiv.appendChild(issueElement);

    const combinedElement = document.createElement('div');
    combinedElement.classList.add('key-issues-quote-box');
    combinedElement.innerHTML =
      `<span class="bold-dark-green">Relevance:</span> ${relevance}<br>` +
      `<span class="bold-dark-green">Mapping:</span> ${mapping}`;
    keyIssuesDiv.appendChild(combinedElement);
  }
});

// =========================
// Explanation
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Explanation');
  if (!records) return;

  const explanation = collectAndSortValues(records, 'Explanation').join('<br>');
  const explanationEl = document.getElementById('explanation');
  if (explanationEl) {
    explanationEl.innerHTML = explanation;
  }
});

// =========================
// Assessment & Management (per-section images)
// =========================
document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('Assessment / Management');
  if (!records) return;

  const box = document.getElementById('assessmentManagement');
  if (!box) return;

  // Helpers
  const normalizeMd = (md) => String(md || "")
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')
    // Turn single newlines into blank lines ONLY when the next line isn't a heading/list
    .replace(/([^\n])\n(?!\n)(?!\s*(?:[-*+]\s|\d+\.\s|#{1,6}\s))/g, '$1\n\n');

  const mdToHtml = (md) => {
    const cleaned = normalizeMd(md);
    if (window.marked) return (marked.parse ? marked.parse(cleaned) : marked(cleaned));
    return cleaned; // fallback: plain text-ish
  };

  const removeEmptyParasAfterLists = (rootEl) => {
    rootEl.querySelectorAll('p').forEach(p => {
      const text = p.textContent.replace(/\u00a0/g, '').trim();
      const prev = p.previousElementSibling;
      if (!text && prev && (prev.tagName === 'UL' || prev.tagName === 'OL')) p.remove();
    });
  };

  // Collect Assessment (all together, as before)
  const assessmentSegments = [];
  // Collect Management grouped by Order so each section can have its own images
  const managementByOrder = new Map(); // order -> { texts: [], imgs: [] }

  records.forEach(record => {
    const order = record.fields['Order'];
    if (order === undefined) return;

    const aText = record.fields['Assessment'];
    if (aText) assessmentSegments.push({ order, text: aText });

    const mText = record.fields['Management'];
    const mImgs = record.fields['Management Image']; // attachments array (0..8)

    if (mText || (Array.isArray(mImgs) && mImgs.length)) {
      if (!managementByOrder.has(order)) managementByOrder.set(order, { texts: [], imgs: [] });

      const entry = managementByOrder.get(order);

      if (mText) entry.texts.push(mText);

      if (Array.isArray(mImgs) && mImgs.length) {
        // Keep only attachments that have a url
        entry.imgs.push(...mImgs.filter(x => x && x.url));
      }
    }
  });

  assessmentSegments.sort((a, b) => a.order - b.order);

  const managementOrders = Array.from(managementByOrder.keys()).sort((a, b) => a - b);

  // If nothing at all, hide
  if (!assessmentSegments.length && !managementOrders.length) {
    box.style.display = 'none';
    return;
  }

  // Clear box and rebuild
  box.innerHTML = '';

  // ---- Render Assessment (combined) ----
  if (assessmentSegments.length) {
    const assessmentMd = assessmentSegments.map(s => s.text).join('\n\n');
    const assessmentHtml = mdToHtml(assessmentMd);

    const assessmentWrap = document.createElement('div');
    assessmentWrap.classList.add('assessment-section');
    assessmentWrap.innerHTML = assessmentHtml;

    box.appendChild(assessmentWrap);
    removeEmptyParasAfterLists(assessmentWrap);
  }

  // ---- Render Management per Order + its images right after ----
  managementOrders.forEach(order => {
    const entry = managementByOrder.get(order);
    if (!entry) return;

    // If you want a bit of spacing between management sections:
    const sectionWrap = document.createElement('div');
    sectionWrap.classList.add('management-section');
    sectionWrap.style.marginTop = '12px';

    // Render management text (could be multiple texts for same order)
    if (entry.texts.length) {
      const md = entry.texts.join('\n\n');
      const html = mdToHtml(md);

      const textWrap = document.createElement('div');
      textWrap.classList.add('management-text');
      textWrap.innerHTML = html;

      sectionWrap.appendChild(textWrap);
      removeEmptyParasAfterLists(textWrap);
    }

    // Render images immediately after this management text
    if (entry.imgs.length) {
      const imgsWrap = document.createElement('div');
      imgsWrap.classList.add('management-images');

      entry.imgs.forEach(file => {
        const img = document.createElement('img');
        img.src = file.url;
        img.alt = file.filename || 'Management image';
        img.loading = 'lazy';
        img.style.width = '100%';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        img.style.margin = '10px auto';

        imgsWrap.appendChild(img);
      });

      sectionWrap.appendChild(imgsWrap);
    }

    box.appendChild(sectionWrap);
  });
});


// =========================
// References
// =========================

document.addEventListener('airtableDataFetched', () => {
  const records = getAirtableRecordsOrExit('References');
  if (!records) return;

  function formatDate(dateString) {
    try {
      const date = new Date(dateString);
      const options = { month: 'long', year: 'numeric' };
      return date.toLocaleDateString('en-US', options);
    } catch (error) {
      console.error('Invalid date format:', dateString);
      return 'Invalid date';
    }
  }

  const references = (function () {
    const arr = [];
    records.forEach(record => {
      const order = record.fields['Order'];
      const value = record.fields['References'];
      const url = record.fields['URL'];
      if (value && order !== undefined) {
        arr.push({ order, value, url });
      }
    });
    arr.sort((a, b) => a.order - b.order);
    return arr;
  })();

  const applications = (function () {
    const arr = [];
    records.forEach(record => {
      const order = record.fields['Order'];
      const value = record.fields['Application'];
      if (value && order !== undefined) {
        arr.push({ order, value });
      }
    });
    arr.sort((a, b) => a.order - b.order);
    return arr;
  })();

  const updatedDates = records
    .map(record => record.fields['Updated'])
    .filter(date => date);
  const latestUpdatedDate = updatedDates.sort((a, b) => new Date(b) - new Date(a))[0];

  const referenceContentDiv = document.getElementById('referenceContent');
  const applicationContentDiv = document.getElementById('applicationContent');
  const lastUpdatedDiv = document.getElementById('lastUpdated');

  if (referenceContentDiv) {
    referenceContentDiv.innerHTML = '';
    references.forEach(item => {
      const referenceElement = document.createElement('div');
      referenceElement.classList.add('reference-item');
      if (item.url) {
        referenceElement.innerHTML = `<a href="${item.url}" target="_blank" title="Read more">${item.value}</a>`;
      } else {
        referenceElement.textContent = item.value;
      }
      referenceContentDiv.appendChild(referenceElement);
    });
  }

  if (applicationContentDiv) {
    applicationContentDiv.innerHTML = '';
    applications.forEach(item => {
      const applicationElement = document.createElement('div');
      applicationElement.classList.add('application-item');
      applicationElement.textContent = item.value;
      applicationContentDiv.appendChild(applicationElement);
    });
  }

  if (lastUpdatedDiv && latestUpdatedDate) {
    lastUpdatedDiv.textContent = formatDate(latestUpdatedDate);
  }
});

// =========================
// If data was already fetched before this script loaded,
// fire the event once so all the above listeners run.
// =========================
if (window.airtableData && Array.isArray(window.airtableData) && window.airtableData.length) {
  document.dispatchEvent(new Event('airtableDataFetched'));
}
