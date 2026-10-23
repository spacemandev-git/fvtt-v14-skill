import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * A settings sub-menu: a small form application opened from the module's button in Configure Settings.
 * Extending HandlebarsApplicationMixin(ApplicationV2) gives PARTS-based Handlebars rendering.
 */
export default class SettingsMenu extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-settings-menu`,
    classes: [MODULE_ID],
    tag: "form",                                      // the whole window is a <form>
    window: {
      title: "__PREFIX__.Menu.Title",                 // localization keys are fine here
      icon: "fa-solid fa-gear",
      contentClasses: ["standard-form"]
    },
    position: { width: 480 },
    form: {
      handler: SettingsMenu.#onSubmit,                // called with `this` bound to the app
      closeOnSubmit: true
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/settings-menu.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }   // core template: renders context.buttons
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return Object.assign(context, {
      greeting: game.settings.get(MODULE_ID, "greeting"),
      placeholder: game.i18n.localize("__PREFIX__.Greeting.Default"),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }]
    });
  }

  /**
   * Save the form. `formData.object` holds the submitted values keyed by input name.
   * @this {SettingsMenu}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {foundry.applications.ux.FormDataExtended} formData
   */
  static async #onSubmit(event, form, formData) {
    await game.settings.set(MODULE_ID, "greeting", formData.object.greeting.trim());
  }
}
