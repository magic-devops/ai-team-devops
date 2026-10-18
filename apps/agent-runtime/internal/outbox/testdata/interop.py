"""Test-only actual Python SDK/SQLite bridge for the Go repository tests."""
import json
import sys
from sop_sdk.event_envelope import FrozenEvent, EventIdentity
from sop_sdk.event_outbox import EventOutbox, QueueError
op,path,*args=sys.argv[1:]
if op == 'fresh_race':
    print('READY',flush=True)
    assert sys.stdin.readline().strip() == 'GO'
    with EventOutbox(path) as q: print(json.dumps(q.stats()),flush=True)
    raise SystemExit(0)
with EventOutbox(path) as q:
    if op=='enqueue':
        event=FrozenEvent.create('sop.interop.fact',{'unicode':'中文 Ω 🙂 < & >','integer':2**80,'float':1.25},event_id='from-python',time='2026-10-18t00:00:00z')
        result=q.enqueue(event,'P')
        other=FrozenEvent.create('sop.interop.fact',{},event_id='python-second',time='2026-10-18T00:00:01Z')
        q.enqueue(other,'P')
        print(json.dumps({'input':event.item() if hasattr(event,'item') else {'id':event.id,'event_json':event.event_json,'digest':event.digest},'result':result,'page':q.list(limit=1)},ensure_ascii=False))
    elif op=='list': print(json.dumps(q.list(limit=1,cursor=args[0]),ensure_ascii=False))
    elif op=='requeue': print(json.dumps(q.requeue(args[0],int(args[1]),args[2],args[3]),ensure_ascii=False))
    elif op=='inspect': print(json.dumps(q.inspect(args[0]),ensure_ascii=False))
    elif op=='conflict':
        old=q.inspect(args[0]);value=json.loads(old['event_json']);value['data']['changed']=True
        changed=FrozenEvent.from_json(json.dumps(value,ensure_ascii=False))
        try: q.enqueue(changed,'P')
        except QueueError as err: print(json.dumps({'error_code':err.code}))
        else: raise AssertionError('changed original ID accepted')
    elif op=='bind': print(json.dumps(q.bind(args[0],int(args[1]),EventIdentity('T','P','U','http://manager')),ensure_ascii=False))
    elif op=='race':
        print('READY',flush=True)
        assert sys.stdin.readline().strip()=='GO'
        try: result=q.fail(args[0],int(args[1]),'race','actual cross-process CAS',max_attempts=1)
        except QueueError as err: result={'error_code':err.code}
        print(json.dumps(result),flush=True)
    else: raise AssertionError(op)
