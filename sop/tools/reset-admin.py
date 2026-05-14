#!/usr/bin/env python3
"""管理员密码重置工具
用法:
  python reset-admin.py                          # 交互式
  python reset-admin.py create admin mypassword  # 创建管理员
  python reset-admin.py reset admin newpassword  # 重置密码

重置后请在浏览器重新登录；自动化脚本请更新环境变量中的 JWT（如 MANAGER_SOP_TOKEN）。
"""
import os, sys, hashlib, uuid
from pathlib import Path

WEB_DIR = Path(__file__).parent.parent / "web"
os.chdir(WEB_DIR)
sys.path.insert(0, str(WEB_DIR))
os.environ.setdefault("DB_TYPE", "sqlite")

env_file = WEB_DIR / ".env"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from path_config import apply_startup_defaults

apply_startup_defaults()

from routers.sql_models import create_all, SessionLocal, User, Tenant

def _hash(p): return hashlib.sha256(p.encode()).hexdigest()

def ensure_tenant(db):
    if not db.get(Tenant, "t-default"):
        db.add(Tenant(id="t-default", name="default", slug="default"))
        db.commit()

def cmd_create(username, password):
    if len(password) < 8:
        print("❌ 密码至少 8 位"); sys.exit(1)
    db = SessionLocal()
    ensure_tenant(db)
    if db.query(User).filter_by(username=username).first():
        print(f"❌ 用户 [{username}] 已存在，请用 reset 命令重置密码"); db.close(); sys.exit(1)
    db.add(User(id=f"u-{uuid.uuid4().hex[:12]}", tenant_id="t-default",
                username=username, password_hash=_hash(password), role="super_admin"))
    db.commit(); db.close()
    print(f"✅ 管理员 [{username}] 创建成功")

def cmd_reset(username, password):
    if len(password) < 8:
        print("❌ 密码至少 8 位"); sys.exit(1)
    db = SessionLocal()
    u = db.query(User).filter_by(username=username).first()
    if not u:
        print(f"❌ 用户 [{username}] 不存在"); db.close(); sys.exit(1)
    u.password_hash = _hash(password)
    db.commit(); db.close()
    print(f"✅ [{username}] 密码重置成功")

def cmd_list():
    db = SessionLocal()
    users = db.query(User).all()
    if not users:
        print("数据库为空，无用户")
    for u in users:
        print(f"  {u.username} [{u.role}] tenant={u.tenant_id}")
    db.close()

def interactive():
    import getpass
    db = SessionLocal()
    users = db.query(User).all()
    db.close()
    print(f"\n当前用户数: {len(users)}")
    for u in users: print(f"  - {u.username} [{u.role}]")

    if not users:
        print("\n数据库为空，创建管理员账号")
        username = input("用户名 [admin]: ").strip() or "admin"
        pw = getpass.getpass("密码（至少8位）: ")
        if len(pw) < 8: print("❌ 密码至少8位"); sys.exit(1)
        cmd_create(username, pw)
    else:
        print("\n选择操作: 1=重置密码  2=新建用户")
        op = input("操作 [1]: ").strip() or "1"
        username = input("用户名: ").strip()
        pw = getpass.getpass("新密码（至少8位）: ")
        if len(pw) < 8: print("❌ 密码至少8位"); sys.exit(1)
        if op == "2": cmd_create(username, pw)
        else: cmd_reset(username, pw)

if __name__ == "__main__":
    create_all()
    args = sys.argv[1:]
    if not args:
        interactive()
    elif args[0] == "list":
        cmd_list()
    elif args[0] == "create" and len(args) == 3:
        cmd_create(args[1], args[2])
    elif args[0] == "reset" and len(args) == 3:
        cmd_reset(args[1], args[2])
    else:
        print(__doc__); sys.exit(1)
