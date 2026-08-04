# SQLi Analysis Results: Demo

## Round 1

### [DEFECT] SQL injection in OrderRepo.GetById (Data/OrderRepo.cs:42)
**Challenge:** id concatenated into SQL string, no parameterization.
- **File**: `Data/OrderRepo.cs` (line 42)
