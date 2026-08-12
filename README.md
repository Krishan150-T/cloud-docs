# Cloud Docs — AWS Deployment Runbook (Console Only)

This is a complete, ordered rebuild guide for deploying a backend + frontend + Postgres project on AWS using ECS Fargate, RDS, S3, and an Application Load Balancer — entirely through the AWS Console. Follow the steps in order; each section explains **what** to do and **why**.

**Architecture at a glance:**
```
Internet
   │
   ▼
[ALB - public subnets] ──/api/*──▶ [ECS backend tasks - private subnets] ──▶ [RDS Postgres - private subnets]
   │                                        │
   └──/* (default)──▶ [ECS frontend tasks]  └──▶ [S3 bucket - file storage]

[EC2 bastion - private subnet] ──▶ [RDS] (via SSM tunnel, for DB inspection only)
```

---

## Table of Contents
1. [IAM Foundations](#1-iam-foundations)
2. [VPC & Networking](#2-vpc--networking)
3. [Security Groups](#3-security-groups)
4. [RDS (PostgreSQL)](#4-rds-postgresql)
5. [ECR (Container Registry)](#5-ecr-container-registry)
6. [ECS Cluster, IAM Roles & Logging](#6-ecs-cluster-iam-roles--logging)
7. [ECS Task Definitions](#7-ecs-task-definitions)
8. [Application Load Balancer](#8-application-load-balancer)
9. [ECS Services](#9-ecs-services)
10. [S3 (File Storage)](#10-s3-file-storage)
11. [EC2 Bastion for RDS Access (SSM)](#11-ec2-bastion-for-rds-access-ssm)
12. [Backend Application Config Requirements](#12-backend-application-config-requirements)
13. [Troubleshooting Log (Real Issues Hit & Fixes)](#13-troubleshooting-log-real-issues-hit--fixes)
14. [Rebuild Checklist (Quick Reference)](#14-rebuild-checklist-quick-reference)

---

## 1. IAM Foundations

**Why:** Every AWS service in this stack authenticates and authorizes through IAM. Getting roles right early avoids a cascade of "access denied" errors later.

### Steps
1. **IAM → Users → Create user** (if not already using a non-root user)
   - Attach `AdministratorAccess` policy for your own console/admin use
   - Enable MFA
2. Do **not** use the AWS root account for daily work.

### Key concepts to remember
- **IAM User** — permanent credentials, for people.
- **IAM Role** — temporary, assumed by services (EC2, ECS tasks) or people. No long-lived keys.
- **Two ECS-specific roles you'll create later:**
  - **Execution role** — used by ECS *itself* to pull images from ECR, write logs to CloudWatch, and fetch secrets referenced in the task definition.
  - **Task role** — used by *your application code* at runtime for AWS API calls (e.g., S3 uploads).

---

## 2. VPC & Networking

**Why:** A VPC is your isolated network. We split it into public subnets (internet-facing — ALB only) and private subnets (everything else — ECS tasks, RDS, bastion) so your app and database are never directly exposed to the internet.

### 2.1 Create the VPC
1. **VPC → Your VPCs → Create VPC**
2. **Name tag**: `cloud-docs-vpc`
3. **IPv4 CIDR block**: `10.0.0.0/16`
4. Leave IPv6 and tenancy as default
5. **Create VPC**
6. Select the VPC → **Actions → Edit VPC settings** → enable **DNS resolution** and **DNS hostnames** (required for RDS endpoints and service discovery to work correctly)

### 2.2 Create 4 subnets (2 public, 2 private, across 2 AZs)

**Why 2 AZs:** ALB requires subnets in ≥2 Availability Zones; RDS subnet groups require ≥2 AZs even for single-AZ deployments. This is a hard AWS requirement, not optional redundancy.

**VPC → Subnets → Create subnet**, repeat 4 times:

| Name | AZ | CIDR | Purpose |
|---|---|---|---|
| `cloud-docs-public-a` | AZ-1 (e.g. `eu-north-1a`) | `10.0.0.0/24` | ALB |
| `cloud-docs-public-b` | AZ-2 (e.g. `eu-north-1b`) | `10.0.1.0/24` | ALB |
| `cloud-docs-private-a` | AZ-1 | `10.0.2.0/24` | ECS tasks, RDS, bastion |
| `cloud-docs-private-b` | AZ-2 | `10.0.3.0/24` | ECS tasks, RDS |

After creating the two public subnets:
1. Select `cloud-docs-public-a` → **Actions → Edit subnet settings** → enable **Auto-assign public IPv4 address**
2. Repeat for `cloud-docs-public-b`

(Private subnets should NOT have auto-assign public IP enabled — leave default/off.)

### 2.3 Create and attach an Internet Gateway

**Why:** Public subnets need a route to the internet. The Internet Gateway is what makes that possible.

1. **VPC → Internet Gateways → Create internet gateway**
2. Name: `cloud-docs-igw`
3. **Create**, then select it → **Actions → Attach to VPC** → select `cloud-docs-vpc`

### 2.4 Create route tables

**Why:** Route tables decide where traffic goes. Public subnets route internet-bound traffic to the Internet Gateway directly. Private subnets route it through a NAT Gateway instead (so resources stay unreachable from outside, but can still make outbound calls — e.g. pulling images, calling external APIs).

**Public route table:**
1. **VPC → Route Tables → Create route table**
2. Name: `cloud-docs-public-rt`, VPC: `cloud-docs-vpc`
3. Select it → **Routes tab → Edit routes → Add route**
   - Destination: `0.0.0.0/0`, Target: Internet Gateway → select `cloud-docs-igw`
4. **Subnet associations tab → Edit subnet associations** → select both public subnets

**Private route table** (create after the NAT Gateway in the next section, since it needs to reference it):
1. **Create route table** → Name: `cloud-docs-private-rt`, VPC: `cloud-docs-vpc`
2. Associate both private subnets
3. Add the NAT route after Section 2.5 below

### 2.5 Create a NAT Gateway

**Why:** Lets private-subnet resources (ECS tasks, bastion) make outbound internet calls (pull Docker images, call external APIs) without being reachable from the internet themselves.

1. **VPC → NAT Gateways → Create NAT gateway**
2. Name: `cloud-docs-nat`
3. **Subnet**: select a **public** subnet (`cloud-docs-public-a`) — NAT Gateway must live in a public subnet
4. **Connectivity type**: Public
5. **Elastic IP allocation ID**: click **Allocate Elastic IP** → use the newly allocated one
6. **Create NAT gateway** — takes a few minutes to become `Available`

**Cost note:** NAT Gateway bills hourly (~$0.045/hr) plus per-GB data processed, even when idle. This is the main recurring cost in this whole stack besides RDS.

Once status shows `Available`, go back to `cloud-docs-private-rt`:
1. **Routes tab → Edit routes → Add route**
   - Destination: `0.0.0.0/0`, Target: NAT Gateway → select `cloud-docs-nat`

---

## 3. Security Groups

**Why:** Security groups are stateful firewalls attached to resources. We chain trust so each layer only accepts traffic from the layer directly in front of it — internet → ALB → ECS → RDS — with nothing able to skip a layer.

### 3.1 ALB Security Group
1. **EC2 → Security Groups → Create security group**
2. Name: `cloud-docs-alb-sg`, VPC: `cloud-docs-vpc`
3. **Inbound rules → Add rule**:
   - HTTP, port 80, source `0.0.0.0/0`
   - (Add HTTPS 443 too if/when you set up TLS)
4. **Create security group**

### 3.2 ECS Tasks Security Group
1. **Create security group** → Name: `cloud-docs-ecs-sg`, VPC: `cloud-docs-vpc`
2. **Inbound rules**:
   - Custom TCP, port `<BACKEND_PORT>` (e.g. 3000), source = `cloud-docs-alb-sg` (select the security group itself, not a CIDR — this means "only traffic originating from something using this SG")
   - Custom TCP, port `80` (frontend/nginx), source = `cloud-docs-alb-sg`
3. **Create security group**

**Common mistake to avoid:** forgetting the second rule for the frontend port, or using the wrong port (e.g. Vite's dev-server port `5173` instead of the actual container port `80` that nginx serves on inside the Docker image).

### 3.3 RDS Security Group
1. **Create security group** → Name: `cloud-docs-rds-sg`, VPC: `cloud-docs-vpc`
2. **Inbound rules**:
   - PostgreSQL, port `5432`, source = `cloud-docs-ecs-sg`
3. **Create security group**

(You'll add one more rule here in Section 11, once the bastion security group exists.)

---

## 4. RDS (PostgreSQL)

**Why RDS instead of a container:** managed backups, patching, and failover; you don't want your database's persistence tied to an ECS task's ephemeral lifecycle.

### 4.1 Create a DB subnet group
1. **RDS → Subnet groups → Create DB subnet group**
2. Name: `cloud-docs-db-subnet-group`
3. VPC: `cloud-docs-vpc`
4. Add both **private** subnets (`cloud-docs-private-a`, `cloud-docs-private-b`)
5. **Create**

### 4.2 Create the database instance
1. **RDS → Databases → Create database**
2. **Engine**: PostgreSQL, choose latest available 16.x version (check what's offered — AWS periodically deprecates specific minor versions)
3. **Templates**: Free tier (if eligible) or Dev/Test
4. **DB instance identifier**: `cloud-docs-db` (hyphens allowed here)
5. **Master username**: `postgres`
6. **Credentials management**: choose **"Managed in AWS Secrets Manager"** — this auto-generates a strong password and stores it securely; you never see/handle it directly, and your app fetches it at runtime
7. **Instance class**: `db.t4g.micro` (burstable, cheapest, likely free-tier eligible)
8. **Storage**: `gp3`, 20 GB
9. **Connectivity**:
   - VPC: `cloud-docs-vpc`
   - **DB subnet group**: `cloud-docs-db-subnet-group`
   - **Public access**: **No** — critical, keeps RDS unreachable from the internet
   - **VPC security group**: select existing → `cloud-docs-rds-sg`
10. **Additional configuration**:
    - **Initial database name**: use **letters/numbers only, no hyphens** (e.g. `clouddocsdb`) — RDS rejects hyphenated DB names even though the instance identifier allows them
    - **Backup retention period**: if you hit a `FreeTierRestrictionError`, lower this to `1` day
    - Disable Multi-AZ for dev/learning (enable later for production HA)
11. **Create database** — takes 5–10 minutes

### 4.3 Retrieve connection details (after status = Available)
1. Click into the DB instance → note the **Endpoint** (hostname) and **Port** (5432)
2. Under **Configuration**, find the link to the **Secrets Manager secret** — open it and note the ARN. You'll reference this ARN (not the actual password) in the ECS task definition later.

---

## 5. ECR (Container Registry)

**Why:** ECS needs to pull your Docker images from somewhere. ECR is AWS's private registry, integrated with IAM so no separate login system is needed.

1. **ECR → Repositories → Create repository**
2. Repository name: `cloud-docs-backend` → **Create**
3. Repeat: **Create repository** → `cloud-docs-frontend` → **Create**
4. Note each repository's **URI** (shown in the repo list) — you'll need it for pushing images and for the ECS task definitions.

**Note:** actually pushing images requires Docker CLI + AWS CLI (`docker build`, `docker push`) since there's no console-only way to upload a Docker image — this is the one part of the workflow that inherently needs a terminal, even though the setup around it is console-driven.

---

## 6. ECS Cluster, IAM Roles & Logging

### 6.1 Create the cluster
1. **ECS → Clusters → Create cluster**
2. Name: `cloud-docs-cluster`
3. Infrastructure: **AWS Fargate (serverless)**
4. **Create**

**Why Fargate over EC2 launch type:** no server/instance management — you just declare CPU/memory per task and AWS handles the underlying compute. For a small number of services, this is simpler and usually cheaper than managing your own EC2 fleet for ECS.

### 6.2 Create the Task Execution Role

**Why this role exists:** ECS itself (not your app code) needs permission to pull images from ECR, write logs to CloudWatch, and fetch any secrets referenced in the task definition.

1. **IAM → Roles → Create role**
2. Trusted entity type: **AWS service**
3. Use case: **Elastic Container Service → Elastic Container Service Task**
4. **Next** → attach policy: `AmazonECSTaskExecutionRolePolicy`
5. **Next** → name it `cloudDocsEcsExecutionRole` → **Create role**
6. Open the role → **Permissions → Add permissions → Create inline policy → JSON**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "<YOUR_RDS_SECRET_ARN>"
    }
  ]
}
```
7. Name it `SecretsAccess` → **Create policy**

### 6.3 Create the Task Role

**Why this role exists:** your *application code* uses this at runtime for AWS API calls it makes directly (e.g., S3 uploads/downloads via the SDK). Kept separate from the execution role so your app's runtime permissions are scoped independently from ECS's own plumbing permissions.

1. **Create role** → same trusted entity/use case as above (**Elastic Container Service Task**)
2. Don't attach any permissions yet
3. Name it `cloudDocsEcsTaskRole` → **Create role**
4. (Later, once you add S3 uploads — see Section 10 — you'll attach an inline policy here for S3 access.)

### 6.4 Create CloudWatch log groups
1. **CloudWatch → Log groups → Create log group**
2. Name: `/ecs/cloud-docs-backend` → **Create**
3. Repeat: `/ecs/cloud-docs-frontend` → **Create**

---

## 7. ECS Task Definitions

**Why:** A task definition is the blueprint for a container — image, CPU/memory, ports, environment variables, secrets, and which IAM roles it uses. Task definitions are **immutable** — every change creates a new numbered revision.

### 7.1 Backend task definition
1. **ECS → Task definitions → Create new task definition**
2. Family: `cloud-docs-backend`
3. Launch type: **AWS Fargate**
4. OS/Architecture: Linux/X86_64 (match whatever platform you built the Docker image for — use `--platform linux/amd64` when building on Apple Silicon Macs to avoid architecture mismatches)
5. CPU/Memory: `.5 vCPU` / `1 GB` (adjust later based on actual usage)
6. **Task execution role**: `cloudDocsEcsExecutionRole`
7. **Task role**: `cloudDocsEcsTaskRole`
8. **Container details**:
   - Name: `backend`
   - Image URI: `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/cloud-docs-backend:latest`
   - Container port: `<BACKEND_PORT>` (e.g. 3000), protocol TCP
9. **Environment variables** (plain):
   - `DB_HOST` = RDS endpoint
   - `DB_PORT` = `5432`
   - `DB_NAME` = your DB name (e.g. `clouddocsdb`)
   - `DB_USER` = `postgres`
   - `AWS_REGION` = your region (e.g. `eu-north-1`)
   - `S3_BUCKET_NAME` = your bucket name (see Section 10)
10. **Environment variables (secret)**:
    - Key: `DB_PASSWORD`
    - Value type: **ValueFrom**
    - Value: `<RDS_SECRET_ARN>:password::` (the `:password::` suffix extracts just the `password` field from the JSON secret; leave version-stage/version-id blank to mean "latest")
11. **Logging**: enable, select existing log group `/ecs/cloud-docs-backend` (don't let it auto-create a duplicate)
12. **Create**

### 7.2 Frontend task definition
1. **Create new task definition** → Family: `cloud-docs-frontend`
2. Fargate, `.25 vCPU` / `0.5 GB` (static file serving needs very little)
3. Task execution role: `cloudDocsEcsExecutionRole`; Task role: `cloudDocsEcsTaskRole` (reused, unused by frontend but harmless)
4. Container:
   - Name: `frontend`
   - Image URI: `<ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/cloud-docs-frontend:latest`
   - Port: `80`
5. No environment variables needed for a static build (unless your frontend needs runtime config)
6. Logging: existing log group `/ecs/cloud-docs-frontend`
7. **Create**

**Important — Vite/CRA env vars are baked in at BUILD time, not runtime.** Setting an ECS environment variable does nothing for values your frontend framework embeds during `npm run build`. If your frontend needs to know the API's base URL, either hardcode it as a relative path (`/api`, recommended — works through the ALB automatically) or set the build-time env var before running `docker build`.

---

## 8. Application Load Balancer

**Why:** Routes incoming internet traffic to the correct ECS service based on URL path, and performs health checks so unhealthy tasks get taken out of rotation automatically.

### 8.1 Create target groups (before the ALB, since the ALB references them)

**Backend target group:**
1. **EC2 → Target Groups → Create target group**
2. Target type: **IP addresses** (required for Fargate — tasks don't have stable EC2 instances)
3. Name: `cloud-docs-backend-tg`
4. Protocol: HTTP, Port: `<BACKEND_PORT>` (e.g. 3000)
5. VPC: `cloud-docs-vpc`
6. **Health check path**: a route that actually exists and returns 200 without requiring auth — e.g. `/api/health` (see Section 13 for why this bit us — do NOT point this at `/` if you're using a global route prefix like `/api`)
7. **Next** → don't register targets manually → **Create target group**

**Frontend target group:**
1. **Create target group** → Target type: IP addresses
2. Name: `cloud-docs-frontend-tg`
3. Protocol: HTTP, Port: `80`
4. VPC: `cloud-docs-vpc`
5. Health check path: `/`
6. **Create target group**

### 8.2 Create the ALB
1. **EC2 → Load Balancers → Create load balancer → Application Load Balancer**
2. Name: `cloud-docs-alb`
3. Scheme: **Internet-facing**
4. VPC: `cloud-docs-vpc`
5. Mappings: select both **public** subnets
6. Security group: `cloud-docs-alb-sg` (remove the default SG if auto-selected)
7. **Listeners**: HTTP : 80 → default action: forward to `cloud-docs-frontend-tg`
8. **Create load balancer**

### 8.3 Add the API routing rule
1. Open `cloud-docs-alb` → **Listeners tab → HTTP:80 → Manage rules**
2. **Add rule**:
   - Condition: **Path** is `/api/*`
   - Action: forward to `cloud-docs-backend-tg`
   - Priority: `1`
3. Save — the default rule (no condition) stays last, catching everything else and sending it to frontend.

---

## 9. ECS Services

**Why:** A service keeps N copies of a task definition running, replaces failed tasks automatically, and registers/deregisters task IPs with the target group as tasks start and stop.

### 9.1 Backend service
1. **ECS → Clusters → cloud-docs-cluster → Services tab → Create**
2. Existing cluster: `cloud-docs-cluster`
3. Task definition family: `cloud-docs-backend` (latest revision)
4. Service name: `cloud-docs-backend-svc`
5. Desired tasks: `1`
6. **Networking**:
   - VPC: `cloud-docs-vpc`
   - Subnets: both **private** subnets
   - Security group: `cloud-docs-ecs-sg`
   - Public IP: **OFF** (tasks are private; reachable only via ALB, and can still reach the internet outbound via NAT for image pulls)
7. **Load balancing**:
   - Application Load Balancer: `cloud-docs-alb`
   - Container: `backend:<BACKEND_PORT>`
   - **Existing** target group: `cloud-docs-backend-tg`
   - Listener: **use existing** HTTP:80 listener (do NOT create a new listener — it already exists with your routing rules)
8. **Create**

### 9.2 Frontend service
Repeat with:
- Task definition family: `cloud-docs-frontend`
- Service name: `cloud-docs-frontend-svc`
- Same private subnets, same `cloud-docs-ecs-sg`, public IP off
- Load balancer: `cloud-docs-alb`, container `frontend:80`, existing target group `cloud-docs-frontend-tg`, existing listener

### 9.3 Verify
1. **EC2 → Target Groups → cloud-docs-backend-tg → Targets tab** → wait for `healthy`
2. Same for `cloud-docs-frontend-tg`
3. Open the ALB's DNS name in a browser — confirm the app loads and (once wired — see Section 12) the frontend can call the backend successfully.

---

## 10. S3 (File Storage)

**Why:** ECS/Fargate storage is ephemeral — any file written to local disk inside a task disappears when that task restarts or redeploys. S3 gives durable, persistent file storage decoupled from the container lifecycle.

### 10.1 Create the bucket
1. **S3 → Create bucket**
2. Bucket name: must be globally unique — e.g. `cloud-docs-uploads-<YOUR_ACCOUNT_ID>`
3. Region: same as everything else
4. **Block Public Access**: leave all four boxes **checked** (fully blocked) — files are served via short-lived signed URLs generated by your backend, never made directly public
5. Leave default encryption (SSE-S3) enabled
6. **Create bucket**

### 10.2 Grant the ECS Task Role access
1. **IAM → Roles → cloudDocsEcsTaskRole → Add permissions → Create inline policy → JSON**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::cloud-docs-uploads-<YOUR_ACCOUNT_ID>/*"
    }
  ]
}
```
2. Name it `S3UploadsAccess` → **Create policy**

**Why the Task Role (not Execution Role):** this permission is used by your *application code* at runtime (the AWS SDK inside your NestJS app), not by ECS's own plumbing. Fargate automatically injects temporary credentials for this role into the container — you never hardcode AWS access keys.

### 10.3 Add required env vars to the backend task definition
Add to the backend task definition (new revision):
- `AWS_REGION` = your region
- `S3_BUCKET_NAME` = your bucket name

*(Application-side code changes — switching multer to memoryStorage, adding an S3Service with PutObject/GetObject/presigned URLs — are backend code changes, not AWS console steps. See Section 12.)*

---

## 11. EC2 Bastion for RDS Access (SSM)

**Why:** RDS is intentionally not publicly accessible. To inspect data with a tool like DBeaver, you need a way into the VPC. An EC2 instance + AWS Systems Manager (SSM) Session Manager gives you this **without** opening any SSH ports or managing key pairs — auth happens via IAM instead.

### 11.1 Create an IAM role for the instance
1. **IAM → Roles → Create role** → AWS service → EC2
2. Attach managed policy: `AmazonSSMManagedInstanceCore`
3. Name: `bastion-ssm-role` → **Create role**

### 11.2 Create a security group for the bastion
1. **EC2 → Security Groups → Create security group**
2. Name: `bastion-sg`, VPC: `cloud-docs-vpc`
3. **No inbound rules needed** — SSM doesn't require any open ports
4. **Create**

### 11.3 Launch the instance
1. **EC2 → Instances → Launch instance**
2. Name: `cloud-docs-bastion`
3. AMI: **Amazon Linux 2023** (SSM agent pre-installed)
4. Instance type: `t3.micro`
5. Key pair: **Proceed without a key pair** (not needed — SSM handles access)
6. Network settings:
   - VPC: `cloud-docs-vpc`
   - Subnet: a **private** subnet
   - Auto-assign public IP: **Disable**
   - Security group: `bastion-sg`
7. **Advanced details → IAM instance profile**: `bastion-ssm-role`
8. **Launch instance**

### 11.4 Allow the bastion to reach RDS
1. **EC2 → Security Groups → cloud-docs-rds-sg → Inbound rules → Edit**
2. Add rule: PostgreSQL (5432), source = `bastion-sg`
3. Save

### 11.5 Connect (requires local CLI — the one place this workflow needs a terminal)
This step cannot be done purely through the console — Session Manager's **port forwarding** feature requires the AWS CLI + Session Manager plugin locally:
```bash
aws ssm start-session \
  --target <INSTANCE_ID> \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters '{"host":["<RDS_ENDPOINT>"],"portNumber":["5432"],"localPortNumber":["5433"]}'
```
Then connect DBeaver (or any Postgres client) to `localhost:5433`, using the DB name/username/password from Secrets Manager.

---

## 12. Backend Application Config Requirements

These aren't AWS console steps, but they're required for the pieces above to actually work — keeping them here so the full picture is in one document.

1. **RDS requires SSL.** Local Postgres typically doesn't need this, but RDS's default `pg_hba.conf` rejects unencrypted connections. In TypeORM (or your ORM of choice), add:
   ```typescript
   ssl: { rejectUnauthorized: false }
   ```
   (For production hardening later: validate against the actual RDS CA bundle instead of skipping validation.)

2. **Frontend API calls must be relative paths**, not `localhost:<port>`. Since the ALB serves both frontend and backend from the same origin, calling `/api/...` (relative) works correctly in every environment. A hardcoded `http://localhost:3000` will always fail once deployed, since that host doesn't exist outside your own machine.

3. **If you add a global route prefix** (e.g. NestJS `app.setGlobalPrefix('api')`), every route shifts under that prefix — including whatever route your ALB health check points to. Make sure the target group's health check path matches a route that actually exists post-prefix, and that it doesn't require authentication (a 401 fails health checks just like a 404 does).

4. **S3 uploads**: switch multer from `diskStorage` to `memoryStorage`, and use `file.buffer` with the AWS SDK's `PutObjectCommand` instead of writing to local disk. Store the S3 **key** in your database (not a full signed URL — those are long and temporary, and will overflow short `varchar` columns and expire).

---

## 13. Troubleshooting Log (Real Issues Hit & Fixes)

Keeping this so future-you doesn't have to rediscover these:

| Symptom | Cause | Fix |
|---|---|---|
| `FreeTierRestrictionError` on RDS creation | Backup retention period too high for free-tier account | Lower `--backup-retention-period` to 1 |
| `Cannot find version 16.4 for postgres` | Specific minor version not offered in your region | Check available versions in the console's engine version dropdown, pick the latest 16.x |
| `DBName must begin with a letter and contain only alphanumeric characters` | RDS `--db-name` doesn't allow hyphens (unlike the instance identifier) | Use a name like `clouddocsdb`, not `cloud-docs-db` |
| ECS task fails: `AccessDeniedException ... secretsmanager:GetSecretValue` | Secrets policy attached to the wrong role, OR Task Role/Execution Role fields swapped in the task definition | Confirm **Task execution role** = the role with the Secrets Manager policy; create a new task definition revision if swapped (task defs are immutable) |
| App logs show `no pg_hba.conf entry for host ... no encryption` | RDS requires SSL, app wasn't configured for it | Add `ssl: { rejectUnauthorized: false }` to the TypeORM/DB config |
| Frontend shows "connection refused" calling the API | Frontend built with `localhost:<port>` hardcoded (baked in at Vite/CRA build time) | Change to a relative path (`/api`), rebuild, redeploy |
| Backend returns `Cannot POST /api/auth/register` (NestJS 404) | Added `setGlobalPrefix('api')` but frontend/backend prefixes mismatched, or stale deployment still serving old image | Verify via CloudWatch startup logs (`Mapped {...} route` lines) which routes are actually registered; confirm task's "Started at" time is after your redeploy |
| ECS task keeps cycling Stopped → Deprovisioning, old task stays alive | ALB health check path doesn't resolve (common after adding a global route prefix — health check still points at `/` which no longer exists) | Point the target group's health check at a route that exists post-prefix (e.g. `/api/health`), ideally a dedicated, unauthenticated health endpoint |
| `docker push` fails with `403 Forbidden` mid-push | ECR auth token expired (12-hour lifetime) | Re-run `aws ecr get-login-password ... \| docker login ...` and retry |
| Docker build fails at runtime with `exec format error` on Fargate | Image built on Apple Silicon (arm64) but Fargate expects x86_64 by default | Build with `--platform linux/amd64` |
| TypeScript error: `Type 'string \| undefined' is not assignable to type 'string'` on `configService.get()` | `ConfigService.get()` returns a possibly-undefined type | Use `configService.getOrThrow<string>(...)` instead — fails fast and loud if config is missing |
| `QueryFailedError: value too long for type character varying(120)` | A DB column's length constraint is too small for the actual value (commonly: storing a full signed S3 URL instead of just the short S3 key) | Store only the S3 key in the DB, generate signed URLs on-demand at request time; or widen the column if genuinely needed |

---

## 14. Rebuild Checklist (Quick Reference)

If you delete everything and start fresh, do it in this order — each step depends on resources from the one before it:

- [ ] IAM admin user + MFA
- [ ] VPC (`10.0.0.0/16`)
- [ ] 4 subnets (2 public, 2 private, across 2 AZs) + auto-assign public IP on public subnets
- [ ] Internet Gateway, attached to VPC
- [ ] Public route table → route to IGW → associate public subnets
- [ ] NAT Gateway (in a public subnet, with an Elastic IP)
- [ ] Private route table → route to NAT → associate private subnets
- [ ] 3 security groups: ALB (80/443 from internet) → ECS (backend/frontend ports from ALB SG) → RDS (5432 from ECS SG)
- [ ] RDS subnet group (both private subnets)
- [ ] RDS instance (not publicly accessible, Secrets Manager-managed credentials, correct SG)
- [ ] 2 ECR repositories (backend, frontend)
- [ ] ECS cluster (Fargate)
- [ ] Task Execution Role (`AmazonECSTaskExecutionRolePolicy` + Secrets Manager inline policy)
- [ ] Task Role (S3 inline policy once you reach that step)
- [ ] 2 CloudWatch log groups
- [ ] 2 task definitions (correct roles assigned to the correct fields!)
- [ ] Build + push both Docker images to ECR (needs local CLI)
- [ ] 2 target groups (IP type, correct ports, correct health check paths)
- [ ] ALB (public subnets, ALB SG, HTTP:80 listener default → frontend TG)
- [ ] ALB routing rule: `/api/*` → backend TG, priority 1
- [ ] 2 ECS services (private subnets, no public IP, wired to existing target groups + existing listener)
- [ ] Verify both target groups show healthy
- [ ] S3 bucket (private, blocked public access) + Task Role S3 permissions
- [ ] Backend env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (ValueFrom secret), `AWS_REGION`, `S3_BUCKET_NAME`
- [ ] (Optional) EC2 bastion + SSM role + SG rule, for RDS inspection via DBeaver
