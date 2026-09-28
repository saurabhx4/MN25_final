import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { recordAudit } from '../modules/audit/audit.service';
import { ensureCanonicalModel } from '../modules/domain/domain.service';
import { objectStorage } from '../lib/storage/object-storage';

const root = process.env.MN25_ML_ENGINE_DIR ?? path.resolve(process.cwd(), '../ml_engine');
const dataRoot = process.env.MN25_DATA_ROOT ?? path.resolve(process.cwd(), '../data');

async function readinessReady() {
  try { const t=await fs.readFile(process.env.MN25_DATA_READINESS_REPORT ?? path.join(dataRoot,'reports/dataset_readiness/DATASET_READINESS_REPORT.md'),'utf8'); return t.includes('Overall status: **READY**'); } catch { return false; }
}
function runPython(args: string[]): Promise<void> {
  return new Promise((resolve,reject)=>{
    const proc=spawn(process.env.PYTHON_BIN ?? 'python',['-m','src.train',...args],{cwd:root,env:{...process.env,PYTHONPATH:root},stdio:['ignore','pipe','pipe']});
    let stderr=''; proc.stderr.on('data',d=>{stderr+=String(d)}); proc.on('error',reject); proc.on('close',code=>code===0?resolve():reject(new Error(stderr||`ML process exited with ${code}`)));
  });
}

export const mlWorker = new Worker('ml-jobs', async job=>{
  if(job.name==='train-prospectivity'){
    const experiment=await prisma.mLExperiment.findUniqueOrThrow({where:{id:job.data.experimentId}});
    if(!(await readinessReady())){
      await prisma.mLExperiment.update({where:{id:experiment.id},data:{status:'BLOCKED',errorMessage:'TRAINING BLOCKED — DATASET INVALID'}}); return;
    }
    await prisma.mLExperiment.update({where:{id:experiment.id},data:{status:'RUNNING',startedAt:new Date()}});
    try{
      const datasetPath=process.env.MN25_CANONICAL_DATASET_PATH ?? path.join(dataRoot,'training/classification/canonical_training.parquet');
      await runPython(['--dataset',datasetPath,'--readiness',process.env.MN25_DATA_READINESS_REPORT ?? path.join(dataRoot,'reports/dataset_readiness/DATASET_READINESS_REPORT.md'),'--dataset-version',experiment.datasetVersion,'--feature-version',experiment.featureVersion,'--output',root+'/artifacts']);
      const comparisonPath=path.join(dataRoot,'reports/ml/MODEL_COMPARISON.json');
      const comparison=JSON.parse(await fs.readFile(comparisonPath,'utf8')) as {models:Record<string,{validation:Record<string,unknown>,test:Record<string,unknown>,calibration:Record<string,unknown>}>};
      const algorithms=Object.keys(comparison.models);
      const trainingDate=new Date();
      for(const algorithm of algorithms){
        const modelName=`MN25 ${algorithm.replace('_',' ').toUpperCase()} Prospectivity`;
        const version=`1.0.${Date.now().toString().slice(-5)}`;
        const registry=await prisma.modelRegistry.upsert({where:{organizationId_name:{organizationId:experiment.organizationId,name:modelName}},update:{purpose:'Manganese prospectivity',type:'PROSPECTIVITY',trainingDataset:experiment.datasetVersion,trainingDate,metrics:comparison.models[algorithm].test},create:{organizationId:experiment.organizationId,name:modelName,purpose:'Manganese prospectivity',type:'PROSPECTIVITY',status:'DRAFT',trainingDataset:experiment.datasetVersion,trainingDate,metrics:comparison.models[algorithm].test}});
        const artifactLocal=path.join(root,'artifacts',`${algorithm}.joblib`);
        const artifactLocation=await objectStorage.put(`ml/${experiment.id}/${algorithm}.joblib`,await fs.readFile(artifactLocal));
        const mv=await prisma.modelVersion.create({data:{modelId:registry.id,name:modelName,version,type:'PROSPECTIVITY',status:'DRAFT',mlStatus:'TRAINED',trainingDataset:experiment.datasetVersion,trainingDate,metrics:comparison.models[algorithm].test,features:{featureVersion:experiment.featureVersion},algorithm,hyperparameters:experiment.hyperparameters,datasetVersion:experiment.datasetVersion,featureVersion:experiment.featureVersion,artifactLocation,codeVersion:experiment.codeVersion,calibration:comparison.models[algorithm].calibration,uncertaintyMethod:'RandomForest tree disagreement when applicable; otherwise not reported',applicabilityMethod:'standardized feature-space distance to training distribution'}});
        await ensureCanonicalModel(mv.id, experiment.organizationId);
        await prisma.mLTrainingRun.create({data:{organizationId:experiment.organizationId,experimentId:experiment.id,modelVersionId:mv.id,status:'COMPLETED',algorithm,artifactLocation,metrics:comparison.models[algorithm].test,regionalMetrics:{validation:comparison.models[algorithm].validation},calibration:comparison.models[algorithm].calibration,uncertainty:{method:'ensemble variance where available'},applicability:{method:'standardized feature-space distance'},startedAt:trainingDate,completedAt:new Date()}});
      }
      await prisma.mLExperiment.update({where:{id:experiment.id},data:{status:'COMPLETED',completedAt:new Date(),metrics:comparison.models,trainingBlocks:comparison.training_blocks,validationBlocks:comparison.validation_blocks,testBlocks:comparison.test_blocks}});
      await recordAudit({organizationId:experiment.organizationId,userId:experiment.createdByUserId,action:'ml.training.completed',resourceType:'MLExperiment',resourceId:experiment.id,metadata:{algorithms}});
    }catch(err){ await prisma.mLExperiment.update({where:{id:experiment.id},data:{status:'FAILED',errorMessage:err instanceof Error?err.message:'ML training failed',completedAt:new Date()}}); throw err; }
    return;
  }

  if(job.name==='predict-prospectivity'){
    const run=await prisma.mLPredictionRun.findUniqueOrThrow({where:{id:job.data.predictionRunId},include:{modelVersion:true}});
    await prisma.mLPredictionRun.update({where:{id:run.id},data:{status:'RUNNING',startedAt:new Date()}});
    try{
      const artifact=run.modelVersion.artifactLocation;
      if(!artifact) throw new Error('MODEL_ARTIFACT_UNAVAILABLE');
      if(!(await objectStorage.exists(artifact))) throw new Error('MODEL_ARTIFACT_UNAVAILABLE');
      // Raster/feature-stack extraction is intentionally delegated to the validated geospatial feature pipeline.
      // Until a ready feature stack exists, fail closed rather than predicting from incomplete inputs.
      throw new Error('FEATURE_STACK_UNAVAILABLE');
    }catch(err){
      const message=err instanceof Error?err.message:'Prediction failed';
      await prisma.mLPredictionRun.update({where:{id:run.id},data:{status:'FAILED',errorMessage:message,completedAt:new Date()}});
      if(run.analysisJobId) await prisma.analysisJob.update({where:{id:run.analysisJobId},data:{status:'FAILED',errorMessage:message,completedAt:new Date(),currentStage:'result_storage',progress:100}});
      throw err;
    }
  }
},{connection:{url:env.redisUrl}});
