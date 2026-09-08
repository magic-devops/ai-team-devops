//go:build windows

package runtool

import (
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var commandJobs sync.Map

func prepareCommand(_ *exec.Cmd) {}

func attachCommand(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return err
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		_ = windows.CloseHandle(job)
		return err
	}
	process, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(cmd.Process.Pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return err
	}
	defer windows.CloseHandle(process)
	if err := windows.AssignProcessToJobObject(job, process); err != nil {
		_ = windows.CloseHandle(job)
		return err
	}
	commandJobs.Store(cmd.Process.Pid, job)
	return nil
}

func terminateCommand(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if job, ok := commandJobs.Load(cmd.Process.Pid); ok {
		_ = windows.TerminateJobObject(job.(windows.Handle), 1)
	}
	_ = cmd.Process.Kill()
}

func cleanupCommand(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if job, ok := commandJobs.LoadAndDelete(cmd.Process.Pid); ok {
		_ = windows.CloseHandle(job.(windows.Handle))
	}
}
