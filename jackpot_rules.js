const COMBO_HEROES_5 = [
  'Hằng Nga',
  'Trư Bát Giới',
  'Tôn Ngộ Không',
  'Hồng Hài Nhi',
  ['Đường Tam Tạng', 'Đường Tăng']
];

function evaluateJackpot(rawCounts) {
  const counts={...rawCounts};
  // Exclude exactly one default gift copy; additional copies still count.
  counts['Cang Kim Tinh Quân']=Math.max(0,(rawCounts['Cang Kim Tinh Quân'] || 0)-1);
  const entries=Object.entries(counts);
  const total=entries.reduce((n,[,c])=>n+c,0);
  const duplicates=entries.filter(([,c])=>c>=2);
  const comboCount = COMBO_HEROES_5.filter(target =>
    Array.isArray(target) ? target.some(t => (counts[t] || 0) >= 1) : (counts[target] || 0) >= 1
  ).length;
  const isCombo3of5 = comboCount >= 3;
  return {
    counts,
    total,
    isSameHeroX2X3: duplicates.length > 0,
    isCoreX2Plus1: duplicates.some(([,c]) => total - c >= 1),
    isMultiTamThanh3: false,
    isCombo3of5,
    isJackpotAlert: duplicates.length > 0 || isCombo3of5
  };
}
module.exports={evaluateJackpot};
