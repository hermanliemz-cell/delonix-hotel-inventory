import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';
import { useApp } from '../hooks/useApp';
import { useTranslation } from '../hooks/useTranslation';
import { PageHeader } from '../components/PageHeader';

function CronJobsPage() {
  const { selectedOrg, showNotification } = useApp();
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [runningJob, setRunningJob] = useState(null);
  const [selectedJob, setSelectedJob] = useState(null);

  useEffect(() => { if (selectedOrg) loadData(); }, [selectedOrg]);

  async function loadData() {
    setLoading(true);
    try {
      // Load pg_cron jobs from cron.job table (via raw SQL through a function)
      // Since cron schema isn't accessible via PostgREST, we use a wrapper
      const { data: jobData, error: jobErr } = await supabase.rpc('get_cron_jobs');
      if (jobErr) {
        // Fallback: show known jobs statically
        setJobs([{
          jobid: 1, schedule: '0 19 * * *', command: 'SELECT inventory.fn_auto_confirm_room_makeups()',
          jobname: 'auto-confirm-room-makeups', nodename: '', nodeport: 0, database: 'postgres', username: 'postgres', active: true,
        }]);
      } else {
        setJobs(jobData || []);
      }

      // Load execution logs
      const { data: logData } = await supabase.from('cron_job_logs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(50);
      setLogs(logData || []);
    } catch (err) {
      // silently handled
    }
    setLoading(false);
  }

  async function handleRunNow(jobName) {
    if (runningJob) return;
    setRunningJob(jobName);
    try {
      const { data, error } = await supabase.rpc('fn_auto_confirm_room_makeups_rpc');
      if (error) throw error;
      showNotification(`Job "${jobName}" executed. Result: ${JSON.stringify(data)}`, 'success');
      await loadData();
    } catch (err) {
      showNotification('Error running job: ' + err.message, 'error');
    }
    setRunningJob(null);
  }

  function formatSchedule(cron) {
    const map = {
      '0 19 * * *': 'Every day at 02:00 WIB (19:00 UTC)',
      '*/5 * * * *': 'Every 5 minutes',
      '0 * * * *': 'Every hour',
    };
    return map[cron] || cron;
  }

  function formatDate(ts) {
    if (!ts) return '-';
    const tz = window.__systemSettings?.timezone || 'Asia/Bangkok';
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(ts));
  }

  function getStatusBadge(status) {
    const colors = {
      SUCCESS: 'bg-green-100 text-green-700',
      RUNNING: 'bg-blue-100 text-blue-700',
      FAILED: 'bg-red-100 text-red-700',
      PARTIAL: 'bg-yellow-100 text-yellow-700',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    );
  }

  return (
    <div>
      <PageHeader title="CRON Jobs" subtitle="Scheduled tasks and execution history" />

      {/* JOB LIST */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 mb-6">
        <div className="p-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700">Scheduled Jobs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Job Name</th>
                <th className="px-4 py-2 font-medium text-gray-600">Schedule</th>
                <th className="px-4 py-2 font-medium text-gray-600">Description</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && !loading ? (
                <tr><td colSpan="5" className="px-4 py-8 text-center text-gray-400">No cron jobs found</td></tr>
              ) : jobs.map((job, idx) => (
                <tr key={idx} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{job.jobname || 'Job #' + job.jobid}</td>
                  <td className="px-4 py-3">
                    <div className="text-gray-700">{formatSchedule(job.schedule)}</div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">{job.schedule}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {job.jobname === 'auto-confirm-room-makeups'
                      ? 'Auto-confirm all DRAFT room makeups daily at 02:00 WIB'
                      : job.command?.substring(0, 60) + (job.command?.length > 60 ? '...' : '')}
                  </td>
                  <td className="px-4 py-3">
                    {job.active !== false
                      ? <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">Inactive</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleRunNow(job.jobname || 'Job #' + job.jobid)}
                      disabled={!!runningJob}
                      className="px-3 py-1 text-xs font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                    >
                      {runningJob === (job.jobname || 'Job #' + job.jobid) ? 'Running...' : 'Run Now'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* EXECUTION LOGS */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="p-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">Execution History</h3>
          <button onClick={loadData} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-4 py-2 font-medium text-gray-600">Job Name</th>
                <th className="px-4 py-2 font-medium text-gray-600">Started At</th>
                <th className="px-4 py-2 font-medium text-gray-600">Finished At</th>
                <th className="px-4 py-2 font-medium text-gray-600">Duration</th>
                <th className="px-4 py-2 font-medium text-gray-600">Status</th>
                <th className="px-4 py-2 font-medium text-gray-600">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && !loading ? (
                <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-400">No execution history yet</td></tr>
              ) : logs.map((log) => {
                const duration = log.started_at && log.finished_at
                  ? ((new Date(log.finished_at) - new Date(log.started_at)) / 1000).toFixed(1) + 's'
                  : '-';
                const details = log.details || {};
                return (
                  <tr key={log.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{log.job_name}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(log.started_at)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDate(log.finished_at)}</td>
                    <td className="px-4 py-3 text-gray-600">{duration}</td>
                    <td className="px-4 py-3">{getStatusBadge(log.status)}</td>
                    <td className="px-4 py-3">
                      {details.confirmed !== undefined ? (
                        <div className="flex items-center gap-2">
                          <span className="text-green-600 font-medium">{details.confirmed} confirmed</span>
                          {details.failed > 0 && <span className="text-red-600 font-medium">{details.failed} failed</span>}
                          {selectedJob === log.id ? (
                            <button onClick={() => setSelectedJob(null)} className="text-xs text-primary-600 underline">Hide</button>
                          ) : (details.items && details.items.length > 0) && (
                            <button onClick={() => setSelectedJob(log.id)} className="text-xs text-primary-600 underline">View</button>
                          )}
                        </div>
                      ) : log.error_message ? (
                        <span className="text-red-600 text-xs">{log.error_message}</span>
                      ) : '-'}
                      {selectedJob === log.id && details.items && (
                        <div className="mt-2 p-2 bg-gray-50 rounded text-xs max-h-40 overflow-y-auto">
                          {details.items.map((item, i) => (
                            <div key={i} className={`py-0.5 ${item.status === 'failed' ? 'text-red-600' : 'text-green-600'}`}>
                              {item.number}: {item.status} {item.error ? `(${item.error})` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default CronJobsPage;