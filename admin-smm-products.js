"use strict";
(() => {
  const form = document.getElementById("smm-product-form");
  if (!form) return;
  const $ = id => document.getElementById(id);
  const message = $("smm-product-message"), supplierSelect = $("smm-provider");
  const serviceSelect = $("smm-service-id"), productsBody = $("smm-products");
  const saveButton = $("smm-save");
  let providers = [], products = [];
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const dollars = minor => "$" + (Number(minor || 0) / 100).toFixed(2);
  const currentSupplier = () => providers.find(item => item.provider === supplierSelect.value);
  const currentService = () => currentSupplier()?.services?.find(item => item.id === serviceSelect.value);

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
  }
  function renderProducts() {
    if (!products.length) {
      productsBody.innerHTML = '<tr><td colspan="6" class="empty">No social media products have been added yet.</td></tr>';
      return;
    }
    productsBody.innerHTML = products.map(item =>
      '<tr><td><b>' + esc(item.productName) + '</b><br><span class="muted">' + esc(item.platform) + '</span>' +
      (item.description ? '<br><span class="muted">' + esc(item.description) + '</span>' : '') + '</td>' +
      '<td>' + esc(item.provider === "peakerr" ? "Peakerr" : "JustAnotherPanel") + '<br><span class="muted">Service ID ' + esc(item.serviceId) + '</span></td>' +
      '<td>' + esc(item.min) + '–' + esc(item.max) + '</td>' +
      '<td><b>' + dollars(item.retailRateMinorPer1000) + '</b></td>' +
      '<td><span class="status ' + (item.active ? "completed" : "failed") + '">' + (item.active ? "Published" : "Hidden") + '</span></td>' +
      '<td><div class="smm-product-actions"><button class="admin-btn" type="button" data-edit-smm="' + esc(item.id) + '">Edit</button>' +
      (item.active ? '<button class="admin-btn" type="button" data-hide-smm="' + esc(item.id) + '">Hide</button>' : '') +
      '</div></td></tr>'
    ).join("");
  }
  async function load() {
    message.textContent = "Loading supplier services and saved products…";
    try {
      const response = await fetch("/api/admin/smm-products", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Social media product manager unavailable.");
      providers = data.providers || [];
      products = data.products || [];
      renderServices(serviceSelect.value);
      renderProducts();
      const summary = providers.map(p => p.label + ": " + (p.connected ? (p.services.length + " services loaded") : "not connected")).join(" · ");
      message.textContent = "Supplier catalogues loaded · " + summary + " · " + products.length + " saved products.";
      if (data.productsTableReady === false) {
        message.textContent += " · " + (data.productsMessage || "Apply the SMM product database migration before saving and publishing.");
      }
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
    $("smm-price").value = "";
    $("smm-description").value = "";
    form.querySelector("button[type=submit]").textContent = "Save and publish product";
    updateServiceInfo();
  }
  supplierSelect.addEventListener("change", () => renderServices());
  serviceSelect.addEventListener("change", updateServiceInfo);
  $("smm-reset").addEventListener("click", clearForm);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const service = currentService();
    if (!service) { message.textContent = "Select a supplier service first."; return; }
    saveButton.disabled = true;
    saveButton.textContent = "Saving product…";
    try {
      const response = await fetch("/api/admin/smm-products", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          id: $("smm-product-id").value || null,
          provider: supplierSelect.value, serviceId: service.id,
          platform: $("smm-platform").value, productName: $("smm-product-name").value,
          description: $("smm-description").value, pricePer1000: $("smm-price").value
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || "Product could not be saved.");
      const index = products.findIndex(item => item.id === data.product.id);
      if (index >= 0) products[index] = data.product; else products.unshift(data.product);
      renderProducts();
      clearForm();
      message.textContent = "Saved. " + data.product.productName + " is now published in the storefront catalogue.";
    } catch (error) {
      message.textContent = error.message || "Product save failed.";
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = "Save and publish product";
    }
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
      $("smm-price").value = (item.retailRateMinorPer1000 / 100).toFixed(2);
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
      renderProducts();
      message.textContent = "Product hidden from the public catalogue.";
    } catch (error) {
      message.textContent = error.message || "Product could not be hidden.";
      hide.disabled = false;
    }
  });
  document.getElementById("refresh")?.addEventListener("click", load);
  load();
})();
