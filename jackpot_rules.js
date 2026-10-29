function evaluateJackpot(rawCounts) {
  const counts={...rawCounts};
  // Exclude exactly one default gift copy; additional copies still count.
  counts['Cang Kim Tinh Quân']=Math.max(0,(rawCounts['Cang Kim Tinh Quân'] || 0)-1);
  const entries=Object.entries(counts);
  const total=entries.reduce((n,[,c])=>n+c,0);
  const duplicates=entries.filter(([,c])=>c>=2);
  return {
    counts,
    total,
    isSameHeroX2X3: duplicates.length > 0,
    isCoreX2Plus1: duplicates.some(([,c]) => total - c >= 1),
    isMultiTamThanh3: false,
    isJackpotAlert: duplicates.length > 0
  };
}
module.exports={evaluateJackpot};
