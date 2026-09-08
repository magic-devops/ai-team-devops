from __future__ import annotations

import errno
import os
import stat
from pathlib import Path


class CoreAlreadyRunning(OSError):
    pass


class InstanceLock:
    def __init__(self, data_dir: Path):
        self.path = data_dir / "core.lock"
        self.fd: int | None = None

    def __enter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(
            self.path,
            os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0),
            0o600,
        )
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or self.path.is_symlink():
                raise OSError("Core lock must be a regular file with no additional links")
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                os.fchmod(fd, 0o600)
        except OSError as exc:
            os.close(fd)
            if exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                raise CoreAlreadyRunning("A Core is already running for this data directory") from exc
            raise
        self.fd = fd
        return self

    def __exit__(self, *_exc):
        if self.fd is not None:
            # Keep the inode: unlinking permits another process to lock a different file.
            os.close(self.fd)
            self.fd = None
