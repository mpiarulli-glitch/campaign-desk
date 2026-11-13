// Where the weekly Basecamp typeahead menu sits.
//
// The account card clips overflow, so the menu is positioned against the
// viewport instead of the card. It opens under the field when that fits, and
// above the field when the card is against the bottom of the screen.

export type SnapPopPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  listMaxHeight: number;
  flip: boolean;
};

const GAP = 4;
const MARGIN = 8;

export function snapPopPlacement(input: {
  anchorTop: number;
  anchorBottom: number;
  anchorLeft: number;
  anchorWidth: number;
  viewportWidth: number;
  viewportHeight: number;
  menuHeight: number;
  chromeHeight: number;
}): SnapPopPlacement {
  const width = Math.min(
    Math.max(input.anchorWidth, 0),
    Math.max(0, input.viewportWidth - MARGIN * 2)
  );
  let left = input.anchorLeft;
  if (left + width > input.viewportWidth - MARGIN) {
    left = input.viewportWidth - MARGIN - width;
  }
  if (left < MARGIN) left = MARGIN;

  const spaceBelow = input.viewportHeight - input.anchorBottom - GAP - MARGIN;
  const spaceAbove = input.anchorTop - GAP - MARGIN;
  const flip = input.menuHeight > spaceBelow && spaceAbove > spaceBelow;
  const available = Math.max(0, flip ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(Math.max(input.menuHeight, 0), available);
  const chrome = Math.min(Math.max(input.chromeHeight, 0), maxHeight);
  const top = flip ? input.anchorTop - GAP - maxHeight : input.anchorBottom + GAP;
  return {
    top,
    left,
    width,
    maxHeight,
    listMaxHeight: Math.max(0, maxHeight - chrome),
    flip,
  };
}
