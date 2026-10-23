import BaseActorData from "./actor-base.mjs";

const { NumberField } = foundry.data.fields;

/** Player character data. */
export default class CharacterData extends BaseActorData {

  /** @override */
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "__PREFIX__.Actor.character"];

  /** @override */
  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      level: new NumberField({ required: true, nullable: false, integer: true, initial: 1, min: 1 })
    });
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.proficiency = 2 + Math.floor((this.level - 1) / 4);
  }

  /** @override */
  getRollData() {
    const data = super.getRollData();
    data.prof = this.proficiency;
    return data;
  }
}
