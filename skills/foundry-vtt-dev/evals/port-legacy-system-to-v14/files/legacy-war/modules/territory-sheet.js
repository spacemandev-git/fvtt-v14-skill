export class TerritorySheet extends ItemSheet {
  static get defaultOptions() {
    return mergeObject(super.defaultOptions, {
      classes: ["legacy-war", "sheet", "item"],
      width: 420,
      height: 360
    });
  }

  get template() {
    return `systems/legacy-war/templates/${this.item.data.type}-sheet.html`;
  }

  getData() {
    const data = super.getData();
    data.isGM = game.user.isGM;
    return data;
  }
}
