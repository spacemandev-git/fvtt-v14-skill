import BaseItemData from "./item-base.mjs";

const { NumberField } = foundry.data.fields;

/** Gear, weapons and other things a character can carry. */
export default class ItemData extends BaseItemData {

  /** @override */
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "__PREFIX__.Item.item"];

  /** @override */
  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      quantity: new NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 0 }),
      weight: new NumberField({ required: true, nullable: false, initial: 0, min: 0 })
    });
  }

  /** @override */
  prepareDerivedData() {
    this.totalWeight = this.quantity * this.weight;
  }
}
