const { HTMLField, StringField } = foundry.data.fields;

/** Data shared by every Item sub-type. */
export default class BaseItemData extends foundry.abstract.TypeDataModel {

  /** @override */
  static LOCALIZATION_PREFIXES = ["__PREFIX__.Item.base"];

  /** @override */
  static defineSchema() {
    return {
      description: new HTMLField(),
      // An optional dice formula. Data paths like @abilities.might.mod resolve against the owning Actor's roll data.
      formula: new StringField({ required: true, blank: true, initial: "" })
    };
  }

  /**
   * Data exposed to dice formulas as `@item.*` (see SystemItem#getRollData).
   * @returns {object}
   */
  getRollData() {
    return { ...this };
  }
}
