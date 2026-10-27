import asyncio,json,sys,pathlib,urllib.request,re
import chay_web_auto as v
from funtap_sdk_login import sdk_login
# Match the user-provided screenshot: keep socket and retry the same code.
Original=v.GiftcodeClaims
class ObservedClaims(Original):
 def __init__(self):
  super().__init__(min_interval=0.18,timeout=1.8,max_attempts=7,reconnect_on_timeout=False)
  self.sent=set()
  self.outcomes={}
  self._consecutive_claimed=0
 def record_packet(self,packet):
  pending=self._pending
  before=pending in self.confirmed
  super().record_packet(packet)
  if pending and not before and pending in self.confirmed:
   msg=int.from_bytes(packet[2:4],'big')
   is_claimed=(msg!=144)
   self.outcomes[pending]='redeemed' if msg==144 else 'already_claimed'
   if is_claimed:
    self._consecutive_claimed+=1
    if self._consecutive_claimed>=2 and len(self.outcomes)==self._consecutive_claimed:
     self._abort=True
   else:
    self._consecutive_claimed=0
 async def claim_all(self,codes,send,reconnect,stopped,progress):
  def observed(index,total,code,attempt):
   progress(index,total,code,attempt)
   target=pathlib.Path(sys.argv[3]+'.progress.json')
   temp=target.with_suffix('.tmp')
   temp.write_text(json.dumps({'index':index,'total':total,'code':code,'attempt':attempt,'confirmed':len(self.confirmed),'timeout':self.timeout,'maxAttempts':self.max_attempts,'reconnectOnTimeout':self.reconnect_on_timeout}))
   temp.replace(target)
  async def tracked_send(code):
   await send(code)
   self.sent.add(code)
  await super().claim_all(codes,tracked_send,reconnect,stopped,observed)
  if self._abort and self._consecutive_claimed>=2:
   for c in codes:
    self.outcomes.setdefault(c,'already_claimed')
    self.confirmed.add(c)
v.GiftcodeClaims=ObservedClaims
def strict_auth(account_id,token=None):
 if not token or token=='r':raise RuntimeError('SDK_TOKEN_REQUIRED')
 u='https://funtap-xy.ridvqqxa.com//funtap/checkLogin.php?'+__import__('urllib.parse',fromlist=['urlencode']).urlencode({'access_token':token,'plt':'android','appVersion':'9.9.9.5'})
 with urllib.request.urlopen(u,timeout=15) as response:d=json.load(response)
 if int(d.get('code',0))!=200 or str(d.get('openid'))!=str(account_id):raise RuntimeError('GAME_AUTH_ACCOUNT_NOT_BOUND')
 if not d.get('time') or not d.get('authkey') or not d.get('userIp'):raise RuntimeError('AUTH_NOT_CONFIRMED')
 return {'timestamp':str(d['time']),'authKey':d['authkey'],'userIp':str(d.get('userIp') or '')}

v.fetch_fresh_authkey=strict_auth
async def main():
 a=json.loads(pathlib.Path(sys.argv[1]).read_text());s=json.loads(pathlib.Path(sys.argv[2]).read_text());s['server']=s['wsUrl']
 auth=await asyncio.to_thread(sdk_login,a['username'],a['password'])
 if auth['accountId']!=str(a['accId']):raise RuntimeError('SDK_ACCOUNT_ID_MISMATCH')
 r=await asyncio.wait_for(v._reroll_single_account({'username':a['username'],'password':a['password'],'accountId':str(a['accId']),'accessToken':auth['accessToken']},s,'own-v79'),timeout=480)
 if not r.get('loginObserved'):raise RuntimeError(r.get('connectionError') or 'GAME_LOGIN_NOT_CONFIRMED')
 pathlib.Path(sys.argv[3]).write_text(json.dumps(r,ensure_ascii=False))
try:asyncio.run(main())
except Exception as e:print('V79_PROBE_FAILED',str(e) if isinstance(e,RuntimeError) else type(e).__name__);sys.exit(1)
