const state = {
  data: null,
  selectedId: null,
  filters: {
    search: "",
    priority: "All",
    disease: "All",
    tissue: "All",
    technology: "All",
  },
};

const $ = (selector) => document.querySelector(selector);
const tooltip = () => $("#tooltip");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value, fallback = "Not reported") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function truncate(value, max = 70) {
  const text = display(value, "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function pct(count, total = state.data.meta.studyCount) {
  return Math.round((Number(count) / Number(total || 1)) * 100);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${Number(count) === 1 ? singular : pluralForm}`;
}

function optionMarkup(values, label) {
  return [
    `<option value="All">All ${escapeHtml(label)}</option>`,
    ...values.map(
      (value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`,
    ),
  ].join("");
}

async function init() {
  if (window.STUDY_DASHBOARD_DATA) {
    state.data = window.STUDY_DASHBOARD_DATA;
  } else {
    const response = await fetch("./dashboard_data.json");
    if (!response.ok) throw new Error("Dashboard data could not be loaded.");
    state.data = await response.json();
  }
  state.selectedId = null;

  renderHeader();
  renderOverview();
  renderFilters();
  bindControls();
  renderExplorer();
}

function renderHeader() {
  const meta = state.data.meta;
  const metrics = [
    [meta.studyCount, "Curated studies", `${meta.yearMin}–${meta.yearMax}`],
    [meta.p1Count, "Priority 1 datasets", `${pct(meta.p1Count)}% of the collection`],
    [
      meta.singleCellCount,
      "Single-cell / nucleus studies",
      `${pct(meta.singleCellCount)}% of studies`,
    ],
    [
      meta.publicValidationCount,
      "Studies using public validation",
      `${pct(meta.publicValidationCount)}% of studies`,
    ],
  ];
  $("#hero-metrics").innerHTML = metrics
    .map(
      ([value, label, note]) => `
        <article class="metric-card">
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(note)}</small>
        </article>
      `,
    )
    .join("");

  $("#source-label").textContent = `${meta.studyCount} study records`;
  $("#footer-source").textContent = `Source: ${meta.generatedFrom}`;
}

function renderOverview() {
  renderYearChart();
  renderPriorityChart();
  renderRankedChart("#disease-chart", state.data.diseaseGroups.slice(0, 7), "disease");
  renderRankedChart("#tissue-chart", state.data.tissueGroups.slice(0, 6), "tissue");
  renderTechnologyChart();
  renderCoverageChart();
}

function renderYearChart() {
  const rows = state.data.years;
  const width = 780;
  const height = 280;
  const left = 34;
  const right = 12;
  const top = 18;
  const bottom = 32;
  const plotHeight = height - top - bottom;
  const plotWidth = width - left - right;
  const max = Math.max(...rows.map((row) => row.count));
  const step = plotWidth / rows.length;
  const barWidth = Math.max(10, step * 0.58);
  const y = (value) => top + plotHeight - (value / max) * plotHeight;

  const guides = [0, 5, 10, 15]
    .filter((value) => value <= max)
    .map(
      (value) => `
        <line class="axis-line" x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}"></line>
        <text class="axis-text" x="${left - 8}" y="${y(value) + 3}" text-anchor="end">${value}</text>
      `,
    )
    .join("");

  const bars = rows
    .map((row, index) => {
      const x = left + index * step + (step - barWidth) / 2;
      const barHeight = (row.count / max) * plotHeight;
      const fill = row.year >= 2022 ? "#7235BE" : "#C7A0F7";
      const showYear = index % 2 === 0 || rows.length <= 8;
      return `
        <g class="year-bar" data-tooltip="${row.year}: ${plural(row.count, "study", "studies")}">
          <rect x="${x}" y="${y(row.count)}" width="${barWidth}" height="${barHeight}" rx="4" fill="${fill}"></rect>
          ${
            row.count
              ? `<text class="axis-text" x="${x + barWidth / 2}" y="${y(row.count) - 7}" text-anchor="middle">${row.count}</text>`
              : ""
          }
          ${
            showYear
              ? `<text class="axis-text" x="${x + barWidth / 2}" y="${height - 9}" text-anchor="middle">${String(row.year).slice(2)}</text>`
              : ""
          }
        </g>
      `;
    })
    .join("");

  $("#year-chart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Studies by publication year">
      ${guides}
      ${bars}
      <text class="axis-text" x="${width - right}" y="${height - 9}" text-anchor="end">publication year</text>
    </svg>
  `;
  bindTooltips(".year-bar");
}

function renderPriorityChart() {
  const rows = state.data.priority;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const colors = {
    P1: "#F78E12",
    P2: "#7235BE",
    P3: "#1D93AD",
    Unassigned: "#CCCCCC",
  };
  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    cursor += (row.count / total) * 100;
    return `${colors[row.label]} ${start}% ${cursor}%`;
  });

  $("#priority-chart").innerHTML = `
    <div class="donut" style="background:conic-gradient(${stops.join(",")})">
      <div class="donut-label">
        <strong>${total}</strong>
        <span>studies</span>
      </div>
    </div>
    <div class="chart-legend">
      ${rows
        .map(
          (row) => `
          <button class="legend-button chart-filter" type="button" data-filter="priority" data-value="${escapeHtml(row.label)}">
            <i style="background:${colors[row.label]}"></i>
            <span>${escapeHtml(row.label)}</span>
            <strong>${row.count}</strong>
          </button>
        `,
        )
        .join("")}
    </div>
  `;
  bindChartFilters();
}

function renderRankedChart(selector, rows, filterName) {
  const max = Math.max(...rows.map((row) => row.count));
  $(selector).innerHTML = rows
    .map(
      (row) => `
      <button class="ranked-row chart-filter" type="button" data-filter="${filterName}" data-value="${escapeHtml(row.label)}">
        <span class="ranked-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span>
        <span class="ranked-track"><i style="width:${(row.count / max) * 100}%"></i></span>
        <strong>${row.count}</strong>
      </button>
    `,
    )
    .join("");
  bindChartFilters();
}

function renderTechnologyChart() {
  const rows = state.data.technologyGroups.slice(0, 6);
  const max = Math.max(...rows.map((row) => row.count));
  $("#technology-chart").innerHTML = rows
    .map(
      (row) => `
      <button class="technology-row chart-filter" type="button" data-filter="technology" data-value="${escapeHtml(row.label)}">
        <div>
          <span>${escapeHtml(row.label)}</span>
          <strong>${row.count}</strong>
        </div>
        <div class="technology-track"><i style="width:${(row.count / max) * 100}%"></i></div>
      </button>
    `,
    )
    .join("");
  bindChartFilters();
}

function renderCoverageChart() {
  $("#coverage-chart").innerHTML = state.data.coverage
    .map(
      (row) => `
      <div class="coverage-row">
        <span>${escapeHtml(row.label)}</span>
        <span class="coverage-track"><i style="width:${pct(row.count, row.total)}%"></i></span>
        <strong>${pct(row.count, row.total)}%</strong>
      </div>
    `,
    )
    .join("");
}

function bindTooltips(selector) {
  document.querySelectorAll(selector).forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const box = tooltip();
      box.textContent = element.dataset.tooltip;
      box.style.display = "block";
      box.style.left = `${event.clientX + 14}px`;
      box.style.top = `${event.clientY + 14}px`;
    });
    element.addEventListener("pointerleave", () => {
      tooltip().style.display = "none";
    });
  });
}

function bindChartFilters() {
  document.querySelectorAll(".chart-filter:not([data-bound])").forEach((button) => {
    button.dataset.bound = "true";
    button.addEventListener("click", () => {
      const filter = button.dataset.filter;
      const value = button.dataset.value;
      state.filters[filter] = value;
      syncFilterControls();
      renderExplorer();
      $("#explore").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderFilters() {
  $("#priority-filter").innerHTML = optionMarkup(
    state.data.priority.map((row) => row.label),
    "priorities",
  );
  $("#disease-filter").innerHTML = optionMarkup(
    state.data.diseaseGroups.map((row) => row.label),
    "diseases",
  );
  $("#tissue-filter").innerHTML = optionMarkup(
    state.data.tissueGroups.map((row) => row.label),
    "specimens",
  );
  $("#technology-filter").innerHTML = optionMarkup(
    state.data.technologyGroups.map((row) => row.label),
    "technologies",
  );
}

function bindControls() {
  $("#study-search").addEventListener("input", (event) => {
    state.filters.search = event.target.value;
    renderExplorer();
  });

  ["priority", "disease", "tissue", "technology"].forEach((filter) => {
    $(`#${filter}-filter`).addEventListener("change", (event) => {
      state.filters[filter] = event.target.value;
      renderExplorer();
    });
  });

  $("#clear-filters").addEventListener("click", () => {
    state.filters = {
      search: "",
      priority: "All",
      disease: "All",
      tissue: "All",
      technology: "All",
    };
    syncFilterControls();
    renderExplorer();
  });
}

function syncFilterControls() {
  $("#study-search").value = state.filters.search;
  ["priority", "disease", "tissue", "technology"].forEach((filter) => {
    $(`#${filter}-filter`).value = state.filters[filter];
  });
}

function filteredStudies() {
  const query = state.filters.search.trim().toLowerCase();
  return state.data.studies
    .filter((study) => {
      const searchable = [
        study.docs,
        study.title,
        study.disease,
        study.tissue,
        study.technology,
        study.author,
        study.platform_name,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!query || searchable.includes(query)) &&
        (state.filters.priority === "All" ||
          study.priority === state.filters.priority) &&
        (state.filters.disease === "All" ||
          study.diseaseGroups.includes(state.filters.disease)) &&
        (state.filters.tissue === "All" ||
          study.primaryTissue === state.filters.tissue) &&
        (state.filters.technology === "All" ||
          study.technologyGroups.includes(state.filters.technology))
      );
    })
    .sort((a, b) => {
      const priorityOrder = { P1: 1, P2: 2, P3: 3, Unassigned: 4 };
      return (
        priorityOrder[a.priority] - priorityOrder[b.priority] ||
        (b.year || 0) - (a.year || 0) ||
        a.docs.localeCompare(b.docs)
      );
    });
}

function renderExplorer() {
  const studies = filteredStudies();
  if (!studies.some((study) => study.id === state.selectedId)) {
    state.selectedId = studies[0]?.id ?? null;
  }
  $("#result-count").textContent = plural(studies.length, "study", "studies");
  renderStudyList(studies);
  renderStudyDetail(studies.find((study) => study.id === state.selectedId));
}

function renderStudyList(studies) {
  if (!studies.length) {
    $("#study-list").innerHTML = `
      <div class="empty-list">
        <strong>No studies match</strong>
        Try removing a filter or using a broader search term.
      </div>
    `;
    return;
  }

  $("#study-list").innerHTML = studies
    .map(
      (study) => `
      <button class="study-card ${study.id === state.selectedId ? "is-selected" : ""}" type="button" data-id="${escapeHtml(study.id)}">
        <div class="study-card-top">
          <span class="accession">${escapeHtml(study.docs)}</span>
          <span class="priority-chip ${study.priority.toLowerCase()}">${escapeHtml(study.priority)}</span>
        </div>
        <h4>${escapeHtml(study.title)}</h4>
        <div class="study-card-meta">
          <span>${escapeHtml(study.year || "Year n/a")}</span>
          <span>${escapeHtml(truncate(study.primaryTissue, 30))}</span>
          <span>${escapeHtml(truncate(study.total_samples, 20))}</span>
        </div>
      </button>
    `,
    )
    .join("");

  document.querySelectorAll(".study-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      renderExplorer();
      if (window.innerWidth < 861) {
        $("#study-detail").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function statusClass(value) {
  if (value === "Yes") return "is-yes";
  if (value === "No") return "is-no";
  return "";
}

function metadataItem(label, value) {
  if (!display(value, "")) return "";
  return `
    <div class="metadata-item">
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function detailSection(title, content) {
  if (!content.trim()) return "";
  return `
    <section class="detail-section">
      <div class="detail-section-heading">
        <h4>${escapeHtml(title)}</h4>
        <div class="detail-copy">${content}</div>
      </div>
    </section>
  `;
}

function paragraph(value) {
  return display(value, "") ? `<p>${escapeHtml(value)}</p>` : "";
}

function renderStudyDetail(study) {
  if (!study) {
    $("#study-detail").innerHTML = `
      <div class="empty-list">
        <strong>Select a study</strong>
        Study metadata will appear here.
      </div>
    `;
    return;
  }

  const tags = [
    ...study.diseaseGroups,
    ...study.tissueGroups,
    ...study.technologyGroups,
  ].filter((value, index, array) => array.indexOf(value) === index);

  const sampleStats = [
    ["Total samples", study.total_samples],
    ["Diseased", study.diseased_samples],
    ["Healthy controls", study.healthy_control_samples],
    ["Treated", study.treated_samples],
  ];

  const statusItems = [
    ["Matched controls", study.matchedControlsStatus],
    ["Patient mapping", study.mappingStatus],
    ["Biological replicates", study.replicatesStatus],
    ["Public validation", study.publicValidationStatus],
  ];

  const publicationUrl = study.pubmed_id
    ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(study.pubmed_id)}/`
    : "";

  const cohortMetadata = [
    metadataItem("Diseased patients", study.total_diseased_patients),
    metadataItem("Healthy-control patients", study.healthy_control_patients),
    metadataItem("Treated patients", study.treated_patients),
    metadataItem("Ejection fraction", study.ejection_fraction_info),
    metadataItem("Comorbidities", study.comorbidities),
    metadataItem("Collection method", study.sample_collection_method),
  ].join("");

  const technicalMetadata = [
    metadataItem("Technology", study.technology),
    metadataItem("Platform", study.platform_name),
    metadataItem("Organism", study.organism),
    metadataItem("Cell line / model", study.cell_line),
    metadataItem("Repository source", study.source),
    metadataItem("Data availability", study.data_availability),
  ].join("");

  const interventionMetadata = [
    metadataItem("Treatment type", study.treatment_type),
    metadataItem("Agent / intervention", study.treatment_agent_name),
    metadataItem("Clinical endpoint", study.clinical_endpoint),
  ].join("");

  const publicationMetadata = [
    metadataItem("Publication", study.publication_title),
    metadataItem("Year", study.year),
    metadataItem("Author", study.author),
    metadataItem("PubMed ID", study.pubmed_id),
  ].join("");

  const validationContent = [
    paragraph(study.orthogonal_validation),
    study.public_datasets_used_for_validation
      ? `<p><strong>Public datasets:</strong> ${escapeHtml(study.public_datasets_used_for_validation)}</p>`
      : "",
  ].join("");

  $("#study-detail").innerHTML = `
    <header class="detail-header">
      <div class="detail-eyebrow">
        <div>
          <span class="accession">${escapeHtml(study.docs)}</span>
          <span class="priority-chip ${study.priority.toLowerCase()}">${escapeHtml(study.priority)}</span>
        </div>
        ${
          study.source_link
            ? `<a class="detail-link" href="${escapeHtml(study.source_link)}" target="_blank" rel="noreferrer">Open source record ↗</a>`
            : ""
        }
      </div>
      <h3>${escapeHtml(study.title)}</h3>
      <p class="detail-subtitle">
        ${escapeHtml(study.disease)} · ${escapeHtml(study.tissue)}
      </p>
      <div class="tag-row">
        ${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    </header>

    <div class="sample-strip">
      ${sampleStats
        .map(
          ([label, value]) => `
          <div class="sample-stat">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(display(value))}</strong>
          </div>
        `,
        )
        .join("")}
    </div>

    ${detailSection(
      "Study at a glance",
      `
        <div class="status-line">
          ${statusItems
            .map(
              ([label, value]) => `
              <span class="status-pill ${statusClass(value)}">
                <i></i>${escapeHtml(label)}: ${escapeHtml(value)}
              </span>
            `,
            )
            .join("")}
        </div>
      `,
    )}

    ${detailSection(
      "Design & cohorts",
      `${paragraph(study.overall_design)}${paragraph(study.study_cohorts)}
       <dl class="metadata-grid">${cohortMetadata}</dl>`,
    )}

    ${detailSection(
      "Methods & access",
      `<dl class="metadata-grid">${technicalMetadata}</dl>`,
    )}

    ${detailSection(
      "Clinical context",
      `<dl class="metadata-grid">${interventionMetadata}</dl>`,
    )}

    ${detailSection("Validation", validationContent)}

    ${detailSection(
      "Publication",
      `<dl class="metadata-grid">${publicationMetadata}</dl>
       ${
         publicationUrl
           ? `<p><a class="detail-link" href="${publicationUrl}" target="_blank" rel="noreferrer">View publication on PubMed ↗</a></p>`
           : ""
       }`,
    )}
  `;
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `
    <main style="padding:40px;font-family:sans-serif">
      <h1>Dashboard unavailable</h1>
      <p>${escapeHtml(error.message)}</p>
      <p>Run this dashboard through a local web server so it can load its data file.</p>
    </main>
  `;
});
