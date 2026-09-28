import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth';
import { evaluateRisks, listRisks, getRisk, matrix, updateRisk, acknowledgeRisk, resolveRisk } from './risk.service';

export const risksRouter = Router();
risksRouter.use(requireAuth);

const query = z.object({ mineId: z.string().uuid().optional(), severity: z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).optional(), status: z.enum(['ACTIVE','MONITORING','ACKNOWLEDGED','RESOLVED']).optional(), date: z.string().date().optional() });
const update = z.object({ status: z.enum(['ACTIVE','MONITORING','ACKNOWLEDGED','RESOLVED']).optional(), mitigation: z.string().max(4000).optional(), ownerId: z.string().uuid().nullable().optional(), notes: z.string().max(4000).optional() }).refine(v => Object.keys(v).length > 0, 'At least one field is required.');
const evaluate = z.object({ mineId: z.string().uuid() });

risksRouter.get('/', async (req,res,next)=>{ try { const q=query.parse(req.query); res.json(await listRisks({ organizationId:req.user!.organizationId, mineId:q.mineId, severity:q.severity, status:q.status, date:q.date ? new Date(`${q.date}T00:00:00.000Z`) : undefined })); } catch(e){next(e);} });
risksRouter.get('/matrix', async (req,res,next)=>{ try { const q=z.object({ mineId:z.string().uuid().optional() }).parse(req.query); res.json(await matrix(req.user!.organizationId,q.mineId)); } catch(e){next(e);} });
risksRouter.post('/evaluate', requireRole('ADMIN','MANAGER'), async (req,res,next)=>{ try { const b=evaluate.parse(req.body); res.status(200).json(await evaluateRisks({ organizationId:req.user!.organizationId, userId:req.user!.id, mineId:b.mineId })); } catch(e){next(e);} });
risksRouter.get('/:id', async(req,res,next)=>{try{const r=await getRisk(req.user!.organizationId,req.params.id); if(!r)return res.status(404).json({error:'not_found',message:'Risk not found.'}); res.json(r);}catch(e){next(e);}});
risksRouter.patch('/:id', requireRole('ADMIN','MANAGER'), async(req,res,next)=>{try{const b=update.parse(req.body); const r=await updateRisk({organizationId:req.user!.organizationId,userId:req.user!.id,id:req.params.id,changes:b}); if(!r)return res.status(404).json({error:'not_found',message:'Risk not found.'}); res.json(r);}catch(e){next(e);}});
risksRouter.post('/:id/acknowledge', requireRole('ADMIN','MANAGER','OPERATOR'), async(req,res,next)=>{try{const r=await acknowledgeRisk(req.user!.organizationId,req.user!.id,req.params.id); if(!r)return res.status(404).json({error:'not_found',message:'Risk not found.'}); res.json(r);}catch(e){next(e);}});
risksRouter.post('/:id/resolve', requireRole('ADMIN','MANAGER'), async(req,res,next)=>{try{const r=await resolveRisk(req.user!.organizationId,req.user!.id,req.params.id); if(!r)return res.status(404).json({error:'not_found',message:'Risk not found.'}); res.json(r);}catch(e){next(e);}});
