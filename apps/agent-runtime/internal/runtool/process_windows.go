//go:build windows

package runtool

import (
	"fmt"
	"os/exec"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var commandJobs sync.Map

func prepareCommand(cmd *exec.Cmd) {
	// No user instruction runs before the whole tree belongs to the kill job.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED | windows.CREATE_NO_WINDOW}
}

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
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	for err = windows.Thread32First(snapshot, &entry); err == nil; err = windows.Thread32Next(snapshot, &entry) {
		if entry.OwnerProcessID != uint32(cmd.Process.Pid) {
			continue
		}
		thread, openErr := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
		if openErr != nil {
			return openErr
		}
		_, resumeErr := windows.ResumeThread(thread)
		_ = windows.CloseHandle(thread)
		return resumeErr
	}
	return fmt.Errorf("suspended command primary thread was not found: %w", err)
}

func commandTreeStopped(cmd *exec.Cmd) bool {
	job, ok := commandJobs.Load(cmd.Process.Pid)
	if !ok {
		return false
	}
	// JOBOBJECT_BASIC_ACCOUNTING_INFORMATION, including ActiveProcesses.
	var info struct {
		TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime int64
		TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses     uint32
	}
	until := time.Now().Add(3 * time.Second)
	for time.Now().Before(until) {
		if windows.QueryInformationJobObject(job.(windows.Handle), windows.JobObjectBasicAccountingInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info)), nil) != nil {
			return false
		}
		if info.ActiveProcesses == 0 {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

func processBackend() string { return "windows_job" }

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
