// Deterministic coordinate ranking keeps both sides of streets and every grove,
// unlike retaining every other item in the paired sidewalk/source arrays.
const rank = tree => {
  let h = Math.imul(Math.round(tree.x * 10), 73856093) ^ Math.imul(Math.round(tree.z * 10), 19349663);
  h = Math.imul(h ^ h >>> 16, 0x45d9f3b); h = Math.imul(h ^ h >>> 16, 0x45d9f3b);
  return (h ^ h >>> 16) >>> 0;
};

/** Retain half the population, preserving trees supporting visible monkeys. */
export function halveTrees(trees, protectedTrees = new Set()) {
  const limit = Math.ceil(trees.length / 2);
  const ranked = trees.map((tree, index) => ({ tree, index, rank: rank(tree), protected: protectedTrees.has(tree) }));
  ranked.sort((a, b) => Number(b.protected) - Number(a.protected) || a.rank - b.rank || a.index - b.index);
  const selected = new Set(ranked.slice(0, limit).map(p => p.tree));
  return trees.filter(tree => selected.has(tree));
}
