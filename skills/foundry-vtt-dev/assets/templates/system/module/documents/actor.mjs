import { SYSTEM } from "../config.mjs";

/**
 * The system's Actor document. Keep this class thin: put per-type data and derived values in the
 * TypeDataModels (module/data/) and use the document class for behavior shared by all types.
 * Registered in the init hook as `CONFIG.Actor.documentClass`.
 */
export default class SystemActor extends foundry.documents.Actor {

  /**
   * Roll data for dice formulas (`@abilities.might.mod`, `@level`, ...). Delegates to the data model.
   * @override
   */
  getRollData() {
    return this.system.getRollData?.() ?? { ...this.system };
  }

  /**
   * Roll an ability check and post it to chat.
   * @param {string} abilityKey   A key of SYSTEM.abilities, e.g. "might"
   * @returns {Promise<Roll|null>}
   */
  async rollAbility(abilityKey) {
    const ability = SYSTEM.abilities[abilityKey];
    if ( !ability ) return null;

    // Rolls are asynchronous: construct, then await evaluate().
    const roll = new Roll(`1d20 + @abilities.${abilityKey}.mod`, this.getRollData());
    await roll.evaluate();

    // toMessage() creates the ChatMessage. The default message mode (public/GM/blind/self) comes from the user's
    // chat setting, so don't pass one unless you mean to override it.
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this }),
      flavor: game.i18n.format("__PREFIX__.Roll.AbilityCheck", { ability: game.i18n.localize(ability.label) })
    });
    return roll;
  }
}
