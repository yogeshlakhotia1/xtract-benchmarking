const state = {
  data: null,
  selectedField: "Tissue",
  selectedDataset: "all",
  selectedAccuracyBucket: "all",
};

const $ = (selector) => document.querySelector(selector);
const fmt = (value) => Number(value).toFixed(Number(value) % 1 === 0 ? 0 : 1);
const pct = (value) => `${fmt(value)}%`;

function tierClass(acc) {
  if (acc >= 80) return "High";
  if (acc >= 50) return "Watch";
  return "Low";
}

function shortText(value, max = 42) {
  if (!value) return value;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function fieldByName(name) {
  return state.data.fields.find((field) => field.field === name);
}

function activeDatasetRows() {
  if (state.selectedAccuracyBucket === "all") return state.data.datasets;
  return datasetAccuracyBins()[Number(state.selectedAccuracyBucket)].datasets;
}

function activeDatasetIds() {
  return new Set(activeDatasetRows().map((dataset) => dataset.dataset));
}

function activeScope() {
  const datasets = activeDatasetRows();
  const samples = datasets.reduce(
    (sum, dataset) => sum + Number(dataset.samples || 0),
    0,
  );
  if (state.selectedAccuracyBucket === "all") {
    return {
      filtered: false,
      label: "All datasets",
      datasets,
      samples,
    };
  }
  const bin = datasetAccuracyBins()[Number(state.selectedAccuracyBucket)];
  return {
    filtered: true,
    label: `${accuracyBucketLabel(bin)} accuracy`,
    datasets,
    samples,
  };
}

function distributionFor(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) {
    return { min: 0, q1: 0, median: 0, q3: 0, max: 0 };
  }
  return {
    min: sorted[0],
    q1: sorted[Math.floor(sorted.length / 4)],
    median: sorted[Math.floor(sorted.length / 2)],
    q3: sorted[Math.floor((sorted.length * 3) / 4)],
    max: sorted[sorted.length - 1],
  };
}

function fieldView(field) {
  const selectedIds = activeDatasetIds();
  const datasetStats = field.datasetStats.filter((row) =>
    selectedIds.has(row.dataset),
  );
  const total = datasetStats.reduce(
    (sum, row) => sum + Number(row.samples || 0),
    0,
  );
  const matched = datasetStats.reduce(
    (sum, row) =>
      sum +
      Number(
        row.matchedSamples != null
          ? row.matchedSamples
          : Math.round(Number(row.samples || 0) * Number(row.accuracy) / 100),
      ),
    0,
  );
  const overallAccuracy = total ? (matched / total) * 100 : 0;
  const accuracies = datasetStats.map((row) => Number(row.accuracy));
  return {
    ...field,
    datasetStats,
    overallAccuracy,
    matched,
    total,
    distribution: distributionFor(accuracies),
    datasetsWithDiscrepancy: datasetStats.filter((row) => row.accuracy < 100)
      .length,
    datasetsCuratedWell: datasetStats.filter((row) => row.accuracy === 100)
      .length,
  };
}

function currentFieldViews() {
  return state.data.fields.map(fieldView);
}

function patternsForField(fieldName, dataset = "all") {
  const rows = state.data.patterns[fieldName] || [];
  const selectedIds = activeDatasetIds();
  return rows.filter(
    (row) =>
      selectedIds.has(row.dataset) &&
      (dataset === "all" || row.dataset === dataset),
  );
}

function sumCounts(rows) {
  return rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
}

async function init() {
  const response = await fetch("./dashboard_data.json?v=20260625-boxplot");
  state.data = await response.json();
  if (!fieldByName(state.selectedField)) {
    state.selectedField = state.data.fields[0].field;
  }
  renderDashboard();
}

function renderDashboard() {
  renderHeader();
  renderScopeBanner();
  renderFieldSelect();
  renderOverview();
  renderDatasetAccuracy();
  renderDrilldown();
}

function clearBucketFilter() {
  state.selectedAccuracyBucket = "all";
  state.selectedDataset = "all";
  renderDashboard();
}

function renderHeader() {
  const meta = state.data.meta;
  const scope = activeScope();
  $("#header-stats").innerHTML = [
    ["Datasets", scope.datasets.length],
    ["Samples", scope.samples],
    ["Fields", meta.fieldCount],
  ]
    .map(
      ([label, value]) => `
        <div class="stat-card">
          <strong>${value}</strong>
          <span>${label}</span>
        </div>
      `,
    )
    .join("");
}

function renderScopeBanner() {
  const scope = activeScope();
  const banner = $("#scope-banner");
  banner.classList.toggle("is-filtered", scope.filtered);
  banner.innerHTML = `
    <div>
      <span>Dataset scope</span>
      <strong>${scope.label}</strong>
      <small>${scope.datasets.length} datasets · ${scope.samples} samples</small>
    </div>
    ${
      scope.filtered
        ? '<button id="scope-clear" class="ghost-button" type="button">Clear filter</button>'
        : ""
    }
  `;
  const clear = $("#scope-clear");
  if (clear) clear.onclick = clearBucketFilter;

  const context = scope.filtered
    ? `Sample-weighted results for ${scope.datasets.length} datasets in the ${scope.label} bucket.`
    : `Sample-weighted results across all ${scope.datasets.length} datasets.`;
  $("#overview-context").textContent = context;
  $("#drilldown-context").textContent = context;
}

function renderFieldSelect() {
  const select = $("#field-select");
  select.innerHTML = currentFieldViews()
    .map(
      (field) =>
        `<option value="${field.field}" ${
          field.field === state.selectedField ? "selected" : ""
        }>${field.field} (${pct(field.overallAccuracy)})</option>`,
    )
    .join("");
  select.onchange = (event) => {
    state.selectedField = event.target.value;
    state.selectedDataset = "all";
    renderOverview();
    renderDrilldown();
  };
}

function renderOverview() {
  renderDistributionChart();
  renderWatchList();
}

function datasetAccuracyBins() {
  const bins = Array.from({ length: 20 }, (_, index) => ({
    index,
    lower: index * 5,
    upper: (index + 1) * 5,
    datasets: [],
  }));

  state.data.datasets.forEach((dataset) => {
    const accuracy = Number(dataset.overallAccuracy);
    const index = Math.min(19, Math.max(0, Math.floor(accuracy / 5)));
    bins[index].datasets.push(dataset);
  });

  bins.forEach((bin) => {
    bin.datasets.sort(
      (a, b) =>
        Number(b.overallAccuracy) - Number(a.overallAccuracy) ||
        a.dataset.localeCompare(b.dataset),
    );
  });
  return bins;
}

function accuracyBucketLabel(bin) {
  return `${bin.lower}–${bin.upper}%`;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function renderDatasetAccuracy() {
  const bins = datasetAccuracyBins();
  const accuracies = state.data.datasets.map((dataset) =>
    Number(dataset.overallAccuracy),
  );
  $("#dataset-accuracy-summary").innerHTML = [
    [pct(median(accuracies)), "Median dataset accuracy"],
    [accuracies.filter((value) => value >= 90).length, "Datasets at 90% or above"],
    [accuracies.filter((value) => value < 80).length, "Datasets below 80%"],
  ]
    .map(
      ([value, label]) => `
        <div class="dataset-summary-item">
          <strong>${value}</strong>
          <span>${label}</span>
        </div>
      `,
    )
    .join("");

  renderDatasetHistogram(bins);
  const selectedBin =
    state.selectedAccuracyBucket === "all"
      ? null
      : bins[Number(state.selectedAccuracyBucket)];
  renderAccuracyBucketDetail(selectedBin);
}

function renderDatasetHistogram(bins) {
  const maxCount = Math.max(...bins.map((bin) => bin.datasets.length), 1);
  $("#dataset-histogram").innerHTML = `
    <div class="histogram-y-label">Number of datasets</div>
    <div class="histogram-plot">
      <div class="histogram-grid-lines" aria-hidden="true">
        ${[0.25, 0.5, 0.75, 1]
          .map(
            (ratio) =>
              `<i style="bottom:${ratio * 100}%"><span>${Math.ceil(
                maxCount * ratio,
              )}</span></i>`,
          )
          .join("")}
      </div>
      <div class="histogram-bars">
        ${bins
          .map((bin) => {
            const count = bin.datasets.length;
            const height = count ? Math.max(10, (count / maxCount) * 100) : 2;
            const selected =
              bin.index === Number(state.selectedAccuracyBucket)
                ? "is-selected"
                : "";
            const muted = count === 0 ? "is-empty" : "";
            return `
              <button
                type="button"
                class="histogram-column ${selected} ${muted}"
                data-bucket="${bin.index}"
                ${count === 0 ? "disabled" : ""}
                aria-label="${accuracyBucketLabel(bin)}: ${count} dataset${
                  count === 1 ? "" : "s"
                }"
              >
                <span class="histogram-count">${count || ""}</span>
                <span class="histogram-track">
                  <i style="height:${height}%"></i>
                </span>
                <span class="histogram-label">${bin.lower}</span>
              </button>
            `;
          })
          .join("")}
      </div>
      <div class="histogram-x-title">Overall dataset accuracy (%)</div>
    </div>
  `;

  document.querySelectorAll(".histogram-column").forEach((column) => {
    column.addEventListener("click", () => {
      state.selectedAccuracyBucket = Number(column.dataset.bucket);
      state.selectedDataset = "all";
      renderDashboard();
    });
  });
}

function renderAccuracyBucketDetail(bin) {
  const datasets = bin
    ? bin.datasets
    : [...state.data.datasets].sort(
        (a, b) =>
          Number(b.overallAccuracy) - Number(a.overallAccuracy) ||
          a.dataset.localeCompare(b.dataset),
      );
  const count = datasets.length;
  $("#bucket-title").textContent = bin ? accuracyBucketLabel(bin) : "All datasets";
  $("#bucket-subtitle").textContent = bin
    ? `${count} dataset${count === 1 ? "" : "s"} actively filtering all views`
    : `${count} datasets included in all views`;
  $("#clear-bucket").hidden = !bin;
  $("#clear-bucket").onclick = clearBucketFilter;

  if (!count) {
    $("#bucket-dataset-list").innerHTML = `
      <div class="empty-state compact">No datasets fall in this interval.</div>
    `;
    return;
  }

  $("#bucket-dataset-list").innerHTML = datasets
    .map(
      (dataset) => `
        <div class="bucket-dataset-row">
          <div>
            <strong>${dataset.dataset}</strong>
            <span>${dataset.samples} samples · ${dataset.evaluatedFields} fields</span>
          </div>
          <strong class="${Number(dataset.overallAccuracy) < 80 ? "bad" : ""}">
            ${pct(dataset.overallAccuracy)}
          </strong>
        </div>
      `,
    )
    .join("");
}

function renderDistributionChart() {
  const fields = currentFieldViews().sort(
    (a, b) => a.overallAccuracy - b.overallAccuracy,
  );
  const width = 830;
  const left = 220;
  const right = 44;
  const top = 36;
  const rowHeight = 31;
  const plotWidth = width - left - right;
  const height = top + fields.length * rowHeight + 52;
  const x = (value) => left + (Number(value) / 100) * plotWidth;
  const tooltip = $("#tooltip");

  const axisTicks = [0, 25, 50, 75, 80, 100]
    .map(
      (tick) => `
        <g class="chart-axis">
          <line x1="${x(tick)}" x2="${x(tick)}" y1="24" y2="${height - 30}" stroke="${
            tick === 80 ? "#C62828" : "#E9E3FC"
          }" stroke-width="${tick === 80 ? 1.5 : 1}" ${
            tick === 80 ? 'stroke-dasharray="4 4"' : ""
          } />
          <text x="${x(tick)}" y="${height - 10}" text-anchor="middle">${tick}%</text>
        </g>
      `,
    )
    .join("");

  const rows = fields
    .map((field, index) => {
      const y = top + index * rowHeight + 12;
      const dist = field.distribution;
      const selected = field.field === state.selectedField ? "is-selected" : "";
      const points = [...field.datasetStats]
        .sort((a, b) => a.dataset.localeCompare(b.dataset))
        .map((dataset, pointIndex) => {
          const xJitter = ((pointIndex % 5) - 2) * 1.5;
          const yJitter = ((Math.floor(pointIndex / 5) % 5) - 2) * 2.5;
          const pointX = Math.max(
            left,
            Math.min(left + plotWidth, x(dataset.accuracy) + xJitter),
          );
          return `
            <circle
              class="dataset-point"
              cx="${pointX}"
              cy="${y + yJitter}"
              r="3.3"
              data-tooltip="${dataset.dataset}: ${pct(dataset.accuracy)} ${field.field} accuracy"
            ></circle>
          `;
        })
        .join("");
      return `
        <g class="distribution-row ${selected}" data-field="${field.field}" data-tooltip="${field.field}: overall ${pct(
          field.overallAccuracy,
        )}; median ${pct(dist.median)}; dataset range ${pct(dist.min)}-${pct(
          dist.max,
        )}; ${field.datasetsWithDiscrepancy} datasets with discrepancies">
          <rect class="distribution-row-bg" x="0" y="${y - 17}" width="${width}" height="${rowHeight}" rx="8"></rect>
          <text class="field-label" x="8" y="${y + 4}">${field.field}</text>
          <line class="box-whisker" x1="${x(dist.min)}" x2="${x(
            dist.max,
          )}" y1="${y}" y2="${y}" />
          <line class="box-whisker-cap" x1="${x(dist.min)}" x2="${x(
            dist.min,
          )}" y1="${y - 6}" y2="${y + 6}" />
          <line class="box-whisker-cap" x1="${x(dist.max)}" x2="${x(
            dist.max,
          )}" y1="${y - 6}" y2="${y + 6}" />
          <rect class="box-iqr" x="${x(dist.q1)}" y="${y - 7}" width="${Math.max(
            2,
            x(dist.q3) - x(dist.q1),
          )}" height="14" rx="4" />
          ${points}
          <line class="box-median" x1="${x(dist.median)}" x2="${x(
            dist.median,
          )}" y1="${y - 10}" y2="${y + 10}" />
          <text class="accuracy-label" x="${width - 10}" y="${y + 4}" text-anchor="end">${pct(
            field.overallAccuracy,
          )}</text>
        </g>
      `;
    })
    .join("");

  $("#distribution-chart").innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="Field accuracy distribution chart">
      ${axisTicks}
      <text class="axis-label" x="${left}" y="16">0%</text>
      <text class="axis-label" x="${x(80) + 6}" y="16">80% threshold</text>
      ${rows}
    </svg>
  `;

  document.querySelectorAll(".distribution-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedField = row.dataset.field;
      state.selectedDataset = "all";
      $("#field-select").value = state.selectedField;
      renderOverview();
      renderDrilldown();
      document
        .querySelector(".drilldown-section")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
    row.addEventListener("mousemove", (event) => {
      tooltip.style.display = "block";
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY + 14}px`;
      tooltip.textContent = row.dataset.tooltip;
    });
    row.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });

  document.querySelectorAll(".dataset-point").forEach((point) => {
    point.addEventListener("mousemove", (event) => {
      event.stopPropagation();
      tooltip.style.display = "block";
      tooltip.style.left = `${event.clientX + 14}px`;
      tooltip.style.top = `${event.clientY + 14}px`;
      tooltip.textContent = point.dataset.tooltip;
    });
    point.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });
  });
}

function renderWatchList() {
  const watch = currentFieldViews()
    .filter((field) => field.overallAccuracy < 90)
    .sort((a, b) => a.overallAccuracy - b.overallAccuracy)
    .slice(0, 8);

  $("#watch-list").innerHTML = watch
    .map(
      (field) => `
      <div class="watch-item" data-field="${field.field}">
        <strong><span>${field.field}</span><span>${pct(field.overallAccuracy)}</span></strong>
        <span>${field.datasetsWithDiscrepancy} discrepancy datasets · ${field.fieldType}</span>
        <div class="mini-bar"><i style="width:${Math.max(4, field.overallAccuracy)}%"></i></div>
      </div>
    `,
    )
    .join("");

  document.querySelectorAll(".watch-item").forEach((item) => {
    item.addEventListener("click", () => {
      state.selectedField = item.dataset.field;
      state.selectedDataset = "all";
      $("#field-select").value = state.selectedField;
      renderOverview();
      renderDrilldown();
      document
        .querySelector(".drilldown-section")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderDrilldown() {
  const field = fieldView(fieldByName(state.selectedField));
  const discrepancyStats = field.datasetStats
    .filter((row) => row.accuracy < 100)
    .sort((a, b) => a.accuracy - b.accuracy || b.mismatches - a.mismatches);
  if (
    state.selectedDataset !== "all" &&
    !discrepancyStats.some((row) => row.dataset === state.selectedDataset)
  ) {
    state.selectedDataset = "all";
  }

  renderFieldSummary(field, discrepancyStats);
  renderDatasetList(field, discrepancyStats);
  renderPivot(field);
  renderPatterns(field);
}

function renderFieldSummary(field, discrepancyStats) {
  const rows = patternsForField(field.field);
  const mismatchCount = sumCounts(rows);
  $("#field-summary").innerHTML = [
    [pct(field.overallAccuracy), "Overall accuracy"],
    [`${field.matched}/${field.total}`, "Matched samples"],
    [field.datasetsCuratedWell, "Datasets curated well"],
    [field.datasetsWithDiscrepancy, "Datasets with discrepancy"],
  ]
    .map(
      ([value, label]) => `
      <div class="summary-card">
        <strong>${value}</strong>
        <span>${label}</span>
      </div>
    `,
    )
    .join("");

  if (!mismatchCount && discrepancyStats.length) {
    $("#field-summary").insertAdjacentHTML(
      "beforeend",
      `<div class="summary-card"><strong>${discrepancyStats.length}</strong><span>Datasets below 100%; row-level pattern unavailable</span></div>`,
    );
  }
}

function renderDatasetList(field, discrepancyStats) {
  $("#clear-dataset").onclick = () => {
    state.selectedDataset = "all";
    renderDrilldown();
  };

  if (!discrepancyStats.length) {
    $("#dataset-list").innerHTML = `
      <div class="empty-state">All ${field.datasetStats.length} datasets are curated well for ${field.field}.</div>
    `;
    return;
  }

  $("#dataset-list").innerHTML = discrepancyStats
    .map(
      (row) => `
      <button class="dataset-row ${
        row.dataset === state.selectedDataset ? "is-selected" : ""
      }" type="button" data-dataset="${row.dataset}">
        <strong>
          <span>${row.dataset}</span>
          <span class="bad">${pct(row.accuracy)}</span>
        </strong>
        <span>${row.mismatches} discrepant samples · ${
          row.samples == null ? "n/a" : row.samples
        } samples</span>
      </button>
    `,
    )
    .join("");

  document.querySelectorAll(".dataset-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedDataset = row.dataset.dataset;
      renderDrilldown();
    });
  });
}

function pivotFromRows(rows) {
  const gtTotals = new Map();
  const toolTotals = new Map();
  const matrix = new Map();
  rows.forEach((row) => {
    const gt = row.groundTruth;
    const tool = row.tool;
    const count = Number(row.count);
    gtTotals.set(gt, (gtTotals.get(gt) || 0) + count);
    toolTotals.set(tool, (toolTotals.get(tool) || 0) + count);
    const key = `${gt}\u0000${tool}`;
    matrix.set(key, (matrix.get(key) || 0) + count);
  });
  const gtValues = [...gtTotals.entries()].sort((a, b) => b[1] - a[1]);
  const toolValues = [...toolTotals.entries()].sort((a, b) => b[1] - a[1]);
  return { gtValues, toolValues, matrix, gtTotals, toolTotals };
}

function renderPivot(field) {
  const rows = patternsForField(field.field, state.selectedDataset);
  const scope = activeScope();
  const datasetLabel =
    state.selectedDataset === "all"
      ? scope.filtered
        ? scope.label
        : "all discrepancy datasets"
      : state.selectedDataset;
  $("#pivot-subtitle").textContent = `${field.field} · ${datasetLabel} · ${sumCounts(
    rows,
  )} discrepant samples`;

  if (!rows.length) {
    $("#pivot-table").innerHTML = `
      <div class="empty-state">No discrepant row-level patterns are available for this selection.</div>
    `;
    return;
  }

  const { gtValues, toolValues, matrix, toolTotals } = pivotFromRows(rows);
  const grandTotal = sumCounts(rows);
  const header = `
    <thead>
      <tr>
        <th>Ground truth</th>
        ${toolValues.map(([tool]) => `<th>${shortText(tool, 26)}</th>`).join("")}
        <th>Grand Total</th>
      </tr>
    </thead>
  `;
  const body = gtValues
    .map(([gt, rowTotal]) => {
      const cells = toolValues
        .map(([tool]) => {
          const value = matrix.get(`${gt}\u0000${tool}`) || "";
          return `<td>${value}</td>`;
        })
        .join("");
      return `<tr><td>${gt}</td>${cells}<td><strong>${rowTotal}</strong></td></tr>`;
    })
    .join("");
  const footer = `
    <tfoot>
      <tr>
        <td>Grand Total</td>
        ${toolValues.map(([tool]) => `<td>${toolTotals.get(tool)}</td>`).join("")}
        <td>${grandTotal}</td>
      </tr>
    </tfoot>
  `;

  $("#pivot-table").innerHTML = `
    <table class="pivot-table">
      ${header}
      <tbody>${body}</tbody>
      ${footer}
    </table>
  `;
}

function renderPatterns(field) {
  const rows = patternsForField(field.field, state.selectedDataset)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  if (!rows.length) {
    $("#pattern-list").innerHTML = `
      <div class="empty-state">No discrepancy patterns to summarize for ${field.field}.</div>
    `;
    return;
  }
  $("#pattern-list").innerHTML = rows
    .map(
      (row) => `
      <article class="pattern-card">
        <strong>${row.count}</strong>
        <span>${row.groundTruth} → ${row.tool}<br />${row.dataset}</span>
      </article>
    `,
    )
    .join("");
}

init().catch((error) => {
  document.body.innerHTML = `<pre>${error.stack || error.message}</pre>`;
});
