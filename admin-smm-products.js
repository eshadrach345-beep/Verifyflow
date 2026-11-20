"use strict";
(() => {
  const form = document.getElementById("smm-product-form");
  if (!form) return;
  const $ = id => document.getElementById(id);
  const message = $("smm-product-message"), supplierSelect = $("smm-provider");
  const serviceSelect = $("smm-service-id"), productsBody = $("smm-products");
  const saveButton = $("smm-save"), bulkButton = $("smm-bulk-publish");
  const serviceList = $("smm-service-list"), searchInput = $("smm-service-search");
  const selectVisible = $("smm-select-visible"), selectAllButton = $("smm-select-all");
  const selectAllTop = $("smm-select-all-top");
  let providers = [], products = [], productsTableReady = true;
  const selectedServices = new Set();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const dollars = minor => "$" + (Number(minor || 0) / 100).toFixed(2);
  const currentSupplier = () => providers.find(item => item.provider === supplierSelect.value);
  const currentService = () => currentSupplier()?.services?.find(item => item.id === serviceSelect.value);
  const markupPercent = () => Number($("smm-markup-percent").value);

  function visibleServices() {
    const services = currentSupplier()?.services || [];
    const query = String(searchInput.value || "").trim().toLowerCase();
    return services.filter(item => !query || [item.name,item.category,item.id,item.type].join(" ").toLowerCase().includes(query));
  }
  function updateSelectionSummary() {
    const services = currentSupplier()?.services || [], visible = visibleServices();
    const count = selectedServices.size;
    const selectedVisible = visible.filter(item => selectedServices.has(item.id)).length;
    $("smm-selection-count").textContent = count.toLocaleString() + " of " + services.length.toLocaleString() + " available services selected";
    bulkButton.disabled = !productsTableReady || count === 0;
    bulkButton.textContent = count ? "Publish " + count.toLocaleString() + " selected services" : "Publish selected services";
    if (selectAllButton) {
      selectAllButton.disabled = services.length === 0;
      selectAllButton.textContent = services.length ? "Select entire catalogue (" + services.length.toLocaleString() + ")" : "Catalogue unavailable";
    }
    if (selectVisible) {
      selectVisible.disabled = visible.length === 0;
      selectVisible.checked = visible.length > 0 && selectedVisible === visible.length;
      selectVisible.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    }
  }
  function renderSelectionList() {
    const visible = visibleServices();
    serviceList.innerHTML = visible.length ? visible.map(item =>
      '<label class="smm-service-option"><input type="checkbox" data-smm-service-check="' + esc(item.id) + '"' +
      (selectedServices.has(item.id) ? " checked" : "") + '><span><b>' + esc(item.name) + '</b><small>' +
      esc(item.category) + ' · ID ' + esc(item.id) + ' · ' + esc(item.min) + '–' + esc(item.max) +
      ' · Supplier rate: ' + esc(item.supplierRateReported ?? "not provided") + ' ' + esc(item.supplierCurrency || "") + '/1K</small></span></label>'
    ).join("") : '<div class="empty">No matching services in this supplier catalogue.</div>';
    updateSelectionSummary();
  }
  function renderServices(selectedId) {
    const provider = currentSupplier();
    const services = provider?.services || [];
    serviceSelect.innerHTML = '<option value="">Choose a service from ' + esc(provider?.label || "supplier") + '</option>' +
      services.map(item => '<option value="' + esc(item.id) + '">' +
        esc(item.name) + ' · ID ' + esc(item.id) + ' · ' + esc(item.min) + '–' + esc(item.max) +
        (item.supplierRateReported ? ' · supplier rate ' + esc(item.supplierRateReported) + (provider.currency ? ' ' + esc(provider.currency) : '') + '/1K' : '') +
        '</option>').join("");
    if (selectedId) serviceSelect.value = String(selectedId);
    updateServiceInfo();
    renderSelectionList();
  }
  function updateServiceInfo() {
    const item = currentService(), provider = currentSupplier();
    $("smm-selected-service").textContent = !item
      ? (provider?.connected ? "Choose a supplier service to see its limits and rate." : (provider?.message || "Supplier is not connected."))
      : "Selected: " + item.name + " · Supplier service ID: " + item.id +
        " · Type: " + item.type + " · Quantity limits: " + item.min + "–" + item.max +
        " · Supplier rate reported: " + (item.supplierRateReported || "not provided") +
        (item.supplierCurrency ? " " + item.supplierCurrency : " (currency not confirmed)") +
        " per 1,000 · Refill: " + (item.refill ? "listed" : "not listed") +
        " · Cancel: " + (item.cancel ? "listed" : "not listed");
    if (item && !$("smm-product-name").value.trim()) $("smm-product-name").value = item.name;
    if (item && !$("smm-platform").value.trim()) $("smm-platform").value = item.category || "Other";
  }
  function renderProducts() {
    if (!products.length) {
      productsBody.innerHTML = '<tr><td colspan="6" class="empty">No social media products have been added yet.</td></tr>';
      return;
    }
    const orderedProducts = [...products].sort((a, b) =>
      Number(a.retailRateMinorPer1000 || Number.MAX_SAFE_INTEGER) -
      Number(b.retailRateMinorPer1000 || Number.MAX_SAFE_INTEGER) ||
      String(a.productName || "").localeCompare(String(b.productName || ""))
    );
    productsBody.innerHTML = orderedProducts.map(item =>
      '<tr><td><b>' + esc(item.productName) + '</b><br><span class="muted">' + esc(item.platform) + '</span>' +
      (item.description ? '<br><span class="muted">' + esc(item.description) + '</span>' : '') + '</td>' +
      '<td>' + esc(item.provider === "peakerr" ? "Peakerr" : "JustAnotherPanel") + '<br><span class="muted">Service ID ' + esc(item.serviceId) + '</span></td>' +
      '<td>' + esc(item.min) + '–' + esc(item.max) + '</td>' +
      '<td><b>' + dollars(item.retailRateMinorPer1000) + '</b><br><span class="muted">' + esc(item.markupPercent ?? "—") + '% markup</span></td>' +
      '<td><span class="status ' + (item.active ? "completed" : "failed") + '">' + (item.active ? "Published" : "Hidden") + '</span></td>' +
      '<td><div class="smm-product-actions"><button class="admin-btn" type="button" data-edit-smm="' + esc(item.id) + '">Edit</button>' +
      (item.active ? '<button class="admin-btn" type="button" data-hide-smm="' + esc(item.id) + '">Hide</button>' : '') +
      '</div></td></tr>'
    ).join("");
  }
  async function load() {
    message.textContent = "Checking for duplicate listings and loading supplier services…";
    let duplicateNote = "";
    try {
      const cleanupResponse = await fetch("/api/admin/smm-products", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "deduplicate" })
      });
      const cleanup = await cleanupResponse.json().catch(() => ({}));
      if (cleanupResponse.ok && cleanup.ok && Number(cleanup.removedCount) > 0) {
        duplicateNote = " Removed " + Number(cleanup.removedCount).toLocaleString() +
          " duplicate listing(s); kept the highest-priced version in each group.";
      } else if (!cleanupResponse.ok) {
        duplicateNote = " Duplicate cleanup could not run: " + (cleanup.error || "Please refresh after signing in.");
      }
    } catch {
      duplicateNote = " Duplicate cleanup could not be completed during this check.";
    }
    message.textContent = "Loading supplier services and saved products…";
    try {
      const response = await fetch("/api/admin/smm-products", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Social media product manager unavailable.");
      providers = data.providers || [];
      products = data.products || [];
      productsTableReady = data.productsTableReady !== false;
      renderServices(serviceSelect.value);
      saveButton.disabled = !productsTableReady;
      renderProducts();
      const summary = providers.map(p => p.label + ": " + (p.connected ? (p.services.length.toLocaleString() + " services loaded") : "not connected")).join(" · ");
      message.textContent = "Supplier catalogues loaded · " + summary + " · " + products.length + " saved products.";
      if (data.productsTableReady === false) message.textContent += " · " + (data.productsMessage || "Apply the SMM product database migration before saving and publishing.");
      message.textContent += duplicateNote;
    } catch (error) {
      message.textContent = error.message || "Unable to load SMM products.";
      productsBody.innerHTML = '<tr><td colspan="6" class="empty">' + esc(message.textContent) + '</td></tr>';
    }
  }
  function clearForm() {
    $("smm-product-id").value = "";
    serviceSelect.value = "";
    $("smm-platform").value = "";
    $("smm-product-name").value = "";
    $("smm-markup-percent").value = "50";
    $("smm-description").value = "";
    saveButton.textContent = productsTableReady ? "Save and publish product" : "Database setup required";
    saveButton.disabled = !productsTableReady;
    updateServiceInfo();
  }
  supplierSelect.addEventListener("change", () => {
    selectedServices.clear();
    searchInput.value = "";
    renderServices();
  });
  serviceSelect.addEventListener("change", updateServiceInfo);
  $("smm-reset").addEventListener("click", clearForm);
  selectAllButton.addEventListener("click", () => {
    const services = currentSupplier()?.services || [];
    services.forEach(item => selectedServices.add(item.id));
    renderSelectionList();
    message.textContent = "Selected all " + services.length.toLocaleString() + " services in " +
      (currentSupplier()?.label || "this supplier") + ". Review the list, then publish when ready.";
  });
  selectVisible.addEventListener("change", () => {
    visibleServices().forEach(item => selectVisible.checked
      ? selectedServices.add(item.id) : selectedServices.delete(item.id));
    renderSelectionList();
  });
  $("smm-clear-selection").addEventListener("click", () => {
    selectedServices.clear();
    renderSelectionList();
  });
  searchInput.addEventListener("input", renderSelectionList);
  serviceList.addEventListener("change", event => {
    const checkbox = event.target.closest("[data-smm-service-check]");
    if (!checkbox) return;
    if (checkbox.checked) selectedServices.add(checkbox.dataset.smmServiceCheck);
    else selectedServices.delete(checkbox.dataset.smmServiceCheck);
    updateSelectionSummary();
  });
  $("smm-markup-percent").addEventListener("input", updateSelectionSummary);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const service = currentService(), markup = markupPercent();
    if (!productsTableReady) { message.textContent = "Apply database migration 006_smm_product_manager.sql before publishing products."; return; }
    if (!service) { message.textContent = "Select a supplier service first."; return; }
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) { message.textContent = "Enter a markup percentage between 0 and 1,000."; return; }
    saveButton.disabled = true;
    saveButton.textContent = "Saving product…";
    try {
      const response = await fetch("/api/admin/smm-products", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          id: $("smm-product-id").value || null, provider: supplierSelect.value,
          serviceId: service.id, platform: $("smm-platform").value,
          productName: $("smm-product-name").value, description: $("smm-description").value,
          markupPercent: markup
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Product could not be saved.");
      const index = products.findIndex(item => item.id === data.product.id);
      if (index >= 0) products[index] = data.product; else products.unshift(data.product);
      renderProducts(); clearForm();
      message.textContent = "Saved. " + data.product.productName + " is published with " + data.product.markupPercent + "% markup.";
    } catch (error) {
      message.textContent = error.message || "Product save failed.";
    } finally {
      saveButton.disabled = !productsTableReady;
      saveButton.textContent = productsTableReady ? "Save and publish product" : "Database setup required";
    }
  });

  bulkButton.addEventListener("click", async () => {
    const ids = Array.from(selectedServices), markup = markupPercent();
    if (!productsTableReady) { message.textContent = "Apply database migration 006_smm_product_manager.sql before publishing products."; return; }
    if (!ids.length) { message.textContent = "Select at least one supplier service."; return; }
    if (!Number.isFinite(markup) || markup < 0 || markup > 1000) { message.textContent = "Enter a markup percentage between 0 and 1,000."; return; }
    bulkButton.disabled = true; bulkButton.textContent = "Publishing selected services…";
    try {
      const response = await fetch("/api/admin/smm-products", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "bulk", provider: supplierSelect.value, serviceIds: ids, markupPercent: markup })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Selected services could not be published.");
      const returned = data.products || [];
      for (const product of returned) {
        const index = products.findIndex(item => item.id === product.id);
        if (index >= 0) products[index] = product; else products.unshift(product);
      }
      selectedServices.clear(); renderSelectionList(); renderProducts();
      message.textContent = "Bulk publish complete: " + data.savedCount + " products published or updated; " +
        data.skippedCount + " skipped (missing/unsupported supplier pricing). Markup: " + markup + "%.";
    } catch (error) {
      message.textContent = error.message || "Bulk publishing failed.";
    } finally { updateSelectionSummary(); }
  });

  productsBody.addEventListener("click", async event => {
    const edit = event.target.closest("[data-edit-smm]");
    const hide = event.target.closest("[data-hide-smm]");
    if (edit) {
      const item = products.find(product => product.id === edit.dataset.editSmm);
      if (!item) return;
      $("smm-product-id").value = item.id;
      supplierSelect.value = item.provider;
      renderServices(item.serviceId);
      $("smm-platform").value = item.platform;
      $("smm-product-name").value = item.productName;
      $("smm-markup-percent").value = item.markupPercent ?? 50;
      $("smm-description").value = item.description || "";
      saveButton.textContent = "Update and publish product";
      $("smm-product-form").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!hide) return;
    hide.disabled = true;
    try {
      const response = await fetch("/api/admin/smm-products", {
        method: "DELETE", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: hide.dataset.hideSmm })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Product could not be hidden.");
      const item = products.find(product => product.id === data.id);
      if (item) item.active = false;
      renderProducts(); message.textContent = "Product hidden from the public catalogue.";
    } catch (error) {
      message.textContent = error.message || "Product could not be hidden.";
      hide.disabled = false;
    }
  });
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
