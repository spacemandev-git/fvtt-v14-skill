import BaseActorData from "./actor-base.mjs";

const { NumberField } = foundry.data.fields;

/** Non-player character data. */
export default class NPCData extends BaseActorData {

  /** @override */
  static LOCALIZATION_PREFIXES = [...super.LOCALIZATION_PREFIXES, "__PREFIX__.Actor.npc"];

  /** @override */
  static defineSchema() {
    return Object.assign(super.defineSchema(), {
      challenge: new NumberField({ required: true, nullable: false, initial: 1, min: 0 })
    });
  }

  /** @override */
  prepareDerivedData() {
    super.prepareDerivedData();
    this.xp = Math.round(this.challenge * 100);
  }
}
