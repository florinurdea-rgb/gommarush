(() => {
  const addTyreBtn = document.getElementById("addTyreBtn");
  const modalOverlay = document.getElementById("modalOverlay");
  const modalClose = document.getElementById("modalClose");
  const dimWidth = document.getElementById("dimWidth");
  const dimProfile = document.getElementById("dimProfile");
  const dimDiameter = document.getElementById("dimDiameter");
  const seasonControl = document.getElementById("seasonControl");
  const segments = Array.from(seasonControl.querySelectorAll(".segment"));
  const placeTireBtn = document.getElementById("placeTireBtn");
  const tireListSection = document.getElementById("tireListSection");
  const tireList = document.getElementById("tireList");

  const SEASON_LABELS = {
    summer: "Summer",
    winter: "Winter",
    "all-season": "All season",
  };

  let tires = [];
  let editingIndex = null;
  let selectedSeason = null;

  function updatePlaceButtonState() {
    const filled =
      dimWidth.value.trim() &&
      dimProfile.value.trim() &&
      dimDiameter.value.trim() &&
      selectedSeason;
    placeTireBtn.disabled = !filled;
  }

  function selectSeason(value) {
    selectedSeason = value;
    segments.forEach((seg) => {
      seg.classList.toggle("active", seg.dataset.value === value);
    });
    updatePlaceButtonState();
  }

  function resetModalFields() {
    dimWidth.value = "";
    dimProfile.value = "";
    dimDiameter.value = "";
    selectedSeason = null;
    segments.forEach((seg) => seg.classList.remove("active"));
    updatePlaceButtonState();
  }

  function openModal(editIndex) {
    editingIndex = typeof editIndex === "number" ? editIndex : null;
    if (editingIndex !== null) {
      const tire = tires[editingIndex];
      dimWidth.value = tire.width;
      dimProfile.value = tire.profile;
      dimDiameter.value = tire.diameter;
      selectSeason(tire.season);
    } else {
      resetModalFields();
    }
    updatePlaceButtonState();
    modalOverlay.hidden = false;
    dimWidth.focus();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    editingIndex = null;
  }

  function iconMarkup(name) {
    if (name === "edit") {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>';
  }

  function renderTireList() {
    tireList.textContent = "";
    tireListSection.hidden = tires.length === 0;

    tires.forEach((tire, index) => {
      const li = document.createElement("li");
      li.className = "tire-item";

      const info = document.createElement("span");
      info.className = "tire-item-info";

      const dims = document.createElement("span");
      dims.textContent = `${tire.width}/${tire.profile}/${tire.diameter}`;
      info.appendChild(dims);

      const seasonTag = document.createElement("span");
      seasonTag.className = "tire-item-season";
      seasonTag.textContent = SEASON_LABELS[tire.season] || tire.season;
      info.appendChild(seasonTag);

      const actions = document.createElement("span");
      actions.className = "tire-item-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "icon-button edit";
      editBtn.setAttribute("aria-label", "Edit tire");
      editBtn.dataset.index = String(index);
      editBtn.innerHTML = iconMarkup("edit");

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-button delete";
      deleteBtn.setAttribute("aria-label", "Delete tire");
      deleteBtn.dataset.index = String(index);
      deleteBtn.innerHTML = iconMarkup("delete");

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(info);
      li.appendChild(actions);
      tireList.appendChild(li);
    });
  }

  addTyreBtn.addEventListener("click", () => openModal(null));
  modalClose.addEventListener("click", closeModal);

  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalOverlay.hidden) closeModal();
  });

  [dimWidth, dimProfile, dimDiameter].forEach((input) => {
    input.addEventListener("input", updatePlaceButtonState);
  });

  segments.forEach((seg) => {
    seg.addEventListener("click", () => selectSeason(seg.dataset.value));
  });

  placeTireBtn.addEventListener("click", () => {
    if (placeTireBtn.disabled) return;
    const tire = {
      width: dimWidth.value.trim(),
      profile: dimProfile.value.trim(),
      diameter: dimDiameter.value.trim(),
      season: selectedSeason,
    };
    if (editingIndex !== null) {
      tires[editingIndex] = tire;
    } else {
      tires.push(tire);
    }
    renderTireList();
    closeModal();
  });

  tireList.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".icon-button.edit");
    const deleteBtn = e.target.closest(".icon-button.delete");

    if (editBtn) {
      openModal(Number(editBtn.dataset.index));
      return;
    }

    if (deleteBtn) {
      const index = Number(deleteBtn.dataset.index);
      tires.splice(index, 1);
      renderTireList();
    }
  });
})();
