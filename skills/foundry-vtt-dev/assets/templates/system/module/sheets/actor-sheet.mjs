import { SYSTEM } from "../config.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

/** Templates live under the system folder, which Foundry serves at /systems/<id>/. */
const TEMPLATES = "systems/__ID__/templates/actor";

/**
 * The Actor sheet for characters and NPCs, built on ApplicationV2.
 *
 * - ActorSheetV2 already implements drag-and-drop: rows with `class="draggable" data-item-id` can be dragged, and
 *   Items dropped on the sheet are created on the Actor (or re-sorted if they already belong to it).
 * - HandlebarsApplicationMixin renders each entry in PARTS as its own template and re-renders parts independently.
 * - The whole window is a <form>. With `submitOnChange` every input change is saved with document.update().
 *
 * @extends {foundry.applications.sheets.ActorSheetV2}
 */
export default class SystemActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["__ID__", "actor"],
    position: { width: 620, height: 640 },
    window: {
      resizable: true,
      contentClasses: ["standard-form"]   // core form styling for .form-group, fieldset, .tab, ...
    },
    form: { submitOnChange: true },
    // `data-action="name"` in a template calls the matching function here, with `this` bound to the sheet.
    // (editImage, configureToken, ... are inherited from the base classes.)
    actions: {
      editItem: SystemActorSheet.#onEditItem,
      createItem: SystemActorSheet.#onCreateItem,
      deleteItem: SystemActorSheet.#onDeleteItem,
      rollAbility: SystemActorSheet.#onRollAbility,
      rollItem: SystemActorSheet.#onRollItem
    }
  };

  /**
   * Each part is a template that must render exactly one root element. Part ids that also appear in TABS (below)
   * are tab panels. `scrollable: [""]` keeps the part's scroll position across re-renders.
   * @override
   */
  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },   // core template, driven by context.tabs
    stats: { template: `${TEMPLATES}/stats.hbs`, scrollable: [""] },
    items: {
      template: `${TEMPLATES}/items.hbs`,
      scrollable: [""],
      templates: [`${TEMPLATES}/item-row.hbs`]   // partials used by this part, loaded before rendering
    },
    biography: { template: `${TEMPLATES}/biography.hbs`, scrollable: [""] }
  };

  /**
   * Tab groups. With exactly one group, ApplicationV2 prepares `context.tabs` automatically;
   * `labelPrefix` turns tab id "stats" into the label key "__PREFIX__.Sheet.Tabs.stats".
   * @override
   */
  static TABS = {
    primary: {
      tabs: [
        { id: "stats", icon: "fa-solid fa-chart-simple" },
        { id: "items", icon: "fa-solid fa-suitcase" },
        { id: "biography", icon: "fa-solid fa-book" }
      ],
      initial: "stats",
      labelPrefix: "__PREFIX__.Sheet.Tabs"
    }
  };

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  /**
   * Shared context for every part. DocumentSheetV2 already provides `document`, `source` (the raw database data,
   * use it for input values), `fields` (the document schema), `editable`, `rootId` and `tabs`.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.actor.system;
    return Object.assign(context, {
      actor: this.actor,
      system,                                // prepared data, including derived values: for display
      systemFields: system.schema.fields,    // the DataFields of the system model: for {{formInput}}/{{formGroup}}
      abilities: this._prepareAbilities(),
      itemGroups: this._prepareItemGroups(),
      featureCategories: SYSTEM.featureCategories
    });
  }

  /**
   * Context specific to one part. The shared context object is reused, so only set what the part needs.
   * @override
   */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    if ( partId in context.tabs ) context.tab = context.tabs[partId];
    if ( partId === "biography" ) {
      // Rich text must be enriched (links, @UUID, inline rolls, secrets) before it is displayed.
      context.enrichedBiography = await TextEditor.implementation.enrichHTML(this.actor.system.biography, {
        secrets: this.actor.isOwner,
        rollData: this.actor.getRollData(),
        relativeTo: this.actor
      });
    }
    return context;
  }

  /**
   * Flatten the abilities into a list that a template can loop over.
   * @returns {object[]}
   * @protected
   */
  _prepareAbilities() {
    const system = this.actor.system;
    const sourceAbilities = this.actor._source.system.abilities;
    const abilityFields = system.schema.fields.abilities.fields;
    return Object.entries(SYSTEM.abilities).map(([key, config]) => ({
      key,
      label: config.label,
      field: abilityFields[key].fields.value,   // DataField used to build the <input>
      value: sourceAbilities[key].value,        // source value: Active Effects must not leak into inputs
      mod: system.abilities[key].mod            // derived value: display only
    }));
  }

  /**
   * Group the Actor's embedded Items by type for the inventory tab.
   * @returns {{type: string, label: string, items: Item[]}[]}
   * @protected
   */
  _prepareItemGroups() {
    const labels = { item: "__PREFIX__.Sheet.Group.item", feature: "__PREFIX__.Sheet.Group.feature" };
    return Object.entries(labels).map(([type, label]) => ({
      type,
      label,
      items: [...(this.actor.itemTypes[type] ?? [])].sort((a, b) => a.sort - b.sort)
    }));
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Find the embedded Item that a clicked element belongs to.
   * @param {HTMLElement} target
   * @returns {Item|undefined}
   * @protected
   */
  _getItem(target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    return this.actor.items.get(id);
  }

  /**
   * Open an embedded Item's sheet.
   * @this {SystemActorSheet}
   * @param {PointerEvent} event
   * @param {HTMLElement} target   The element with the data-action attribute
   */
  static #onEditItem(event, target) {
    this._getItem(target)?.sheet.render({ force: true });
  }

  /**
   * Create a new embedded Item of the type in `data-type`, then open its sheet.
   * @this {SystemActorSheet}
   */
  static async #onCreateItem(event, target) {
    if ( !this.isEditable ) return;
    const type = target.dataset.type;
    const cls = foundry.documents.Item.implementation;
    const item = await cls.create({ name: cls.defaultName({ type, parent: this.actor }), type }, { parent: this.actor });
    item?.sheet.render({ force: true });
  }

  /**
   * Delete an embedded Item after a confirmation dialog.
   * @this {SystemActorSheet}
   */
  static async #onDeleteItem(event, target) {
    if ( !this.isEditable ) return;
    await this._getItem(target)?.deleteDialog();
  }

  /**
   * Roll an ability check.
   * @this {SystemActorSheet}
   */
  static async #onRollAbility(event, target) {
    await this.actor.rollAbility(target.dataset.ability);
  }

  /**
   * Roll an Item's formula.
   * @this {SystemActorSheet}
   */
  static async #onRollItem(event, target) {
    await this._getItem(target)?.roll();
  }
}
