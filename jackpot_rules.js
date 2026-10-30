const COMBO_HEROES_4 = [
  ['Đường Tam Tạng', 'Đường Tăng'],
  ['Trư Bát Giới', 'Bát Giới'],
  ['Tôn Ngộ Không', 'Ngộ Không'],
  ['Lý Tịnh', 'Ly Tinh']
];

function evaluateJackpot(rawCounts) {
  const counts={...rawCounts};
  // Exclude exactly one default gift copy; additional copies still count.
  counts['Cang Kim Tinh Quân']=Math.max(0,(rawCounts['Cang Kim Tinh Quân'] || 0)-1);
  const entries=Object.entries(counts);
  const total=entries.reduce((n,[,c])=>n+c,0);
  const duplicates=entries.filter(([,c])=>c>=2);

  const comboCount = COMBO_HEROES_4.filter(target =>
    Array.isArray(target) ? target.some(t => (counts[t] || 0) >= 1) : (counts[target] || 0) >= 1
  ).length;
  const isCombo3of4 = comboCount >= 3;

  return {
    counts,
    total,
    isSameHeroX2X3: duplicates.length > 0,
    isCoreX2Plus1: duplicates.some(([,c]) => total - c >= 1),
    isMultiTamThanh3: false,
    isCombo3of4,
    isJackpotAlert: duplicates.length > 0 || isCombo3of4
  };
}
module.exports={evaluateJackpot};
