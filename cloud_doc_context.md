# Cloud Docs — AWS Cloud-Native Document Management POC

## 1. Overview

**Cloud Docs** is a full-stack document management application developed as an AWS cloud-native Proof of Concept (POC).

The application provides basic document-management capabilities similar to a lightweight Google Drive/Dropbox experience, allowing users to **upload, view, and delete documents** through a web interface.

The primary objective of this POC is not only to demonstrate the application functionality, but also to demonstrate how a full-stack application can be deployed on AWS using managed and containerized services.

The application is deployed using **Amazon ECS with Fargate**, with **Amazon RDS PostgreSQL** for persistent database storage and **Amazon S3** for document storage. Traffic is exposed through an **Application Load Balancer (ALB)**, while the application runs inside a private VPC architecture.

---

## 2. What We Have Built

The solution consists of two application components:

* **Frontend** — Web interface through which users interact with their documents.
* **Backend** — REST API responsible for authentication/application logic, document operations, database interaction, and S3 integration.

The backend and frontend are packaged as Docker images and stored in **Amazon ECR**. They are then deployed as separate ECS Fargate services.

The backend uses:

* **PostgreSQL on Amazon RDS** for application/database metadata.
* **Amazon S3** for actual document/file storage.

This separates application metadata from file storage and ensures that uploaded files are not dependent on the lifecycle of an ECS container.

---

## 3. AWS Architecture

At a high level, the request flow is:

**User → Application Load Balancer → ECS Frontend / ECS Backend → RDS / S3**

The architecture is divided into public and private network layers:

* **Public subnets** contain the internet-facing Application Load Balancer.
* **Private subnets** contain the ECS tasks and RDS database.
* A **NAT Gateway** allows private resources to make outbound connections without exposing them directly to the internet.

The ALB uses path-based routing:

* `/api/*` → **Backend ECS service**
* Other requests → **Frontend ECS service**

This means the frontend and backend can be accessed through the same ALB endpoint while remaining separate ECS services.

---

## 4. Role of the Main AWS Services

| AWS Service         | Purpose in the POC                                                               |
| ------------------- | -------------------------------------------------------------------------------- |
| **Amazon VPC**      | Provides the isolated network environment for the application                    |
| **ALB**             | Provides the public entry point and routes requests to frontend/backend services |
| **ECS Fargate**     | Runs the containerized frontend and backend without managing EC2 servers         |
| **ECR**             | Stores Docker images for the frontend and backend                                |
| **RDS PostgreSQL**  | Stores persistent application and document metadata                              |
| **S3**              | Stores the actual uploaded documents                                             |
| **CloudWatch**      | Collects ECS application logs for monitoring and troubleshooting                 |
| **IAM**             | Controls access between AWS services and the application                         |
| **Secrets Manager** | Securely stores database credentials used by the backend                         |
| **NAT Gateway**     | Provides outbound internet access for resources in private subnets               |

---

## 5. How Document Upload Works

A typical document upload follows this flow:

1. The user selects a document from the frontend.
2. The frontend sends the upload request to the backend through the ALB using the `/api/*` route.
3. The backend receives the file and uploads it to the **S3 bucket**.
4. The backend stores the relevant document metadata and S3 object key in **PostgreSQL/RDS**.
5. When the document needs to be accessed, the backend can generate a temporary signed URL rather than making the S3 bucket public.

The S3 bucket remains private, with public access blocked. The ECS task role provides the backend with the required permissions to upload, retrieve, and delete objects.

This approach keeps the actual files in durable storage while keeping the database focused on application metadata.

---

## 6. Security & Networking Approach

One of the important aspects of the POC is that the application is **not deployed with every component directly exposed to the internet**.

The architecture follows a layered approach:

**Internet → ALB → ECS → RDS**

* Only the ALB is internet-facing.
* ECS tasks run in private subnets and do not receive public IP addresses.
* RDS is private and is not publicly accessible.
* Security groups restrict communication between the layers.
* RDS accepts PostgreSQL traffic only from the ECS security group.
* S3 public access is blocked.
* AWS IAM roles provide temporary permissions to ECS instead of hardcoded AWS credentials.

This demonstrates the basic principles of network isolation, least-privilege access, and separation of responsibilities between AWS services.

---

## 7. Monitoring & Observability

Both the frontend and backend ECS services send their container logs to **Amazon CloudWatch**.

This allows us to inspect:

* Application startup
* API requests and application errors
* Database connection issues
* ECS task failures
* Deployment-related issues

The ALB also performs health checks against the ECS services. Unhealthy tasks are automatically removed from traffic, allowing ECS to replace failed tasks.

---

## 8. What We Will Demonstrate

The demo will focus on both **application functionality** and the **AWS deployment architecture**.

### Application Demo

We will demonstrate:

1. Opening the deployed Cloud Docs application.
2. Using the document-management interface.
3. Uploading a document.
4. Verifying that the document is stored successfully.
5. Viewing/accessing the uploaded document.
6. Deleting the document.
7. Verifying that the document is removed.

### AWS Demo

Alongside the application flow, we will show the corresponding AWS resources:

* **ECS Cluster and Services**

  * Frontend service
  * Backend service
  * Running Fargate tasks

* **Application Load Balancer**

  * Public endpoint
  * Frontend default routing
  * `/api/*` backend routing
  * Target-group health status

* **RDS PostgreSQL**

  * Database running privately inside the VPC
  * Application metadata stored in the database

* **S3**

  * Private document storage
  * Uploaded document/object

* **CloudWatch**

  * Backend/frontend container logs
  * Application activity and troubleshooting visibility

* **VPC & Security**

  * Public vs private subnet architecture
  * Security-group-based communication between ALB, ECS, and RDS

---

## 9. Key Takeaways

The POC demonstrates how a traditional full-stack application can be transformed into a cloud-native deployment using AWS managed services.

The important architectural concepts demonstrated are:

* **Containerization** using Docker
* **Serverless container execution** using ECS Fargate
* **Managed relational database** using RDS PostgreSQL
* **Durable object storage** using S3
* **Load balancing and path-based routing** using ALB
* **Private networking** using VPC and private subnets
* **IAM-based service-to-service access**
* **Secure credential management** using Secrets Manager
* **Application logging and monitoring** using CloudWatch
* **Health checks and service recovery** through ALB and ECS

The POC therefore demonstrates both sides of the solution: **the working document-management application and the AWS architecture required to run it securely and reliably.**
