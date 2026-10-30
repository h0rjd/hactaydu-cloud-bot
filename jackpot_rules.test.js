const {test}=require('node:test');const assert=require('node:assert/strict');const {evaluateJackpot}=require('./jackpot_rules');
test('x2 and x3 qualify, a gifted Cang Kim does not upgrade the combo',()=>{
 const x=evaluateJackpot({'Dương Tiễn':2,'Cang Kim Tinh Quân':1});assert.equal(x.isJackpotAlert,true);assert.equal(x.isCoreX2Plus1,false);
 assert.equal(evaluateJackpot({'Na Tra':3}).isJackpotAlert,true);
});
test('x2 plus an additional non-gifted core qualifies as a combo',()=>{
 assert.equal(evaluateJackpot({'Dương Tiễn':2,'Đường Tam Tạng':1,'Cang Kim Tinh Quân':1}).isCoreX2Plus1,true);
});
test('three distinct non-target singles never qualify',()=>{
 assert.equal(evaluateJackpot({'Dương Tiễn':1,'Na Tra':1,'Hoàng My':1,'Cang Kim Tinh Quân':1}).isJackpotAlert,false);
});
test('1 Ton Ngo Khong plus 1 Duong Tam Tang does not qualify as jackpot',()=>{
 assert.equal(evaluateJackpot({'Tôn Ngộ Không':1,'Đường Tam Tạng':1}).isJackpotAlert,false);
 assert.equal(evaluateJackpot({'Tôn Ngộ Không':1,'Na Tra':1}).isJackpotAlert,false);
});
test('combo 3/4 targets qualify as jackpot alert without duplicates',()=>{
 const hit1 = evaluateJackpot({'Đường Tam Tạng':1,'Trư Bát Giới':1,'Tôn Ngộ Không':1});
 assert.equal(hit1.isJackpotAlert,true);
 assert.equal(hit1.isCombo3of4,true);

 const hit2 = evaluateJackpot({'Đường Tam Tạng':1,'Tôn Ngộ Không':1,'Lý Tịnh':1});
 assert.equal(hit2.isJackpotAlert,true);
 assert.equal(hit2.isCombo3of4,true);

 const hit3 = evaluateJackpot({'Trư Bát Giới':1,'Tôn Ngộ Không':1,'Lý Tịnh':1});
 assert.equal(hit3.isJackpotAlert,true);
 assert.equal(hit3.isCombo3of4,true);

 const hit4 = evaluateJackpot({'Đường Tam Tạng':1,'Trư Bát Giới':1,'Lý Tịnh':1});
 assert.equal(hit4.isJackpotAlert,true);
 assert.equal(hit4.isCombo3of4,true);

 const hitAll = evaluateJackpot({'Đường Tam Tạng':1,'Trư Bát Giới':1,'Tôn Ngộ Không':1,'Lý Tịnh':1});
 assert.equal(hitAll.isJackpotAlert,true);
 assert.equal(hitAll.isCombo3of4,true);

 const miss2 = evaluateJackpot({'Đường Tam Tạng':1,'Trư Bát Giới':1,'Dương Tiễn':1});
 assert.equal(miss2.isJackpotAlert,false);
 assert.equal(miss2.isCombo3of4,false);
});
test('only the one gifted Cang Kim is excluded',()=>{
 const gift=evaluateJackpot({'Cang Kim Tinh Quân':1});
 assert.equal(gift.isJackpotAlert,false);assert.equal(gift.total,0);
 assert.equal(evaluateJackpot({'Cang Kim Tinh Quân':2}).isJackpotAlert,false);
 const triple=evaluateJackpot({'Cang Kim Tinh Quân':3});
 assert.equal(triple.counts['Cang Kim Tinh Quân'],2);assert.equal(triple.isJackpotAlert,true);
 assert.equal(evaluateJackpot({'Dương Tiễn':2,'Cang Kim Tinh Quân':1}).isCoreX2Plus1,false);
 assert.equal(evaluateJackpot({'Dương Tiễn':2,'Cang Kim Tinh Quân':2}).isCoreX2Plus1,true);
});
