const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;
const { TextEditor } = foundry.applications.ux;

const TEMPLATES = "systems/__ID__/templates/item";

/**
 * The Item sheet for all Item sub-types.
 * @extends {foundry.applications.sheets.ItemSheetV2}
 */
export default class SystemItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    classes: ["__ID__", "item"],
    position: { width: 520, height: 480 },
    window: {
      resizable: true,
      contentClasses: ["standard-form"]
    },
    form: { submitOnChange: true },
    actions: {
      rollItem: SystemItemSheet.#onRollItem
    }
  };

  /** @override */
  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    description: { template: `${TEMPLATES}/description.hbs`, scrollable: [""] },
    details: { template: `${TEMPLATES}/details.hbs`, scrollable: [""] }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "description", icon: "fa-solid fa-align-left" },
        { id: "details", icon: "fa-solid fa-sliders" }
      ],
      initial: "description",
      labelPrefix: "__PREFIX__.Sheet.Tabs"
    }
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;
    return Object.assign(context, {
      item: this.item,
      system,
      systemFields: system.schema.fields,
      typeLabel: CONFIG.Item.typeLabels[this.item.type]
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    await super._preparePartContext(partId, context, options);
    if ( partId in context.tabs ) context.tab = context.tabs[partId];
    if ( partId === "description" ) {
      context.enrichedDescription = await TextEditor.implementation.enrichHTML(this.item.system.description, {
        secrets: this.item.isOwner,
        rollData: this.item.getRollData(),
        relativeTo: this.item
      });
    }
    return context;
  }

  /**
   * Roll this Item's formula.
   * @this {SystemItemSheet}
   */
  static async #onRollItem() {
    await this.item.roll();
  }
}
